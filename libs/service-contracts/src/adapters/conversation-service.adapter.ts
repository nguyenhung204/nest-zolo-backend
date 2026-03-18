import { Injectable, Inject, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  CircuitBreakerService,
  ServiceUnavailableException,
  ERROR_CODES,
} from '@app/common';
import { IConversationService } from '../conversation/IConversationService.interface';
import {
  ConversationDto,
  MembershipDto,
  CreateConversationDto,
  MembershipResult,
} from '../conversation/conversation.dto';
import {
  ConversationDtoSchema,
  MembershipDtoSchema,
  MembershipResultSchema,
} from '../schemas/conversation.schema';
import { parseResponse } from '../utils/parse';
import { SERVICES } from '@app/common/constants/services.constants';
import { CONVERSATION_PATTERNS } from '@app/common/constants/patterns/conversation.patterns';

function isServiceUnavailable(error: any): boolean {
  return (
    error instanceof TimeoutError ||
    error?.code === 'ECONNREFUSED' ||
    error?.message?.includes('ECONNREFUSED') ||
    error?.message?.includes('connect ETIMEDOUT') ||
    error?.message === 'Connection closed' ||
    (error?.statusCode ?? error?.status) === 503
  );
}

/**
 * Conversation Service TCP Adapter
 *
 * - Timeout: 5 000 ms per call
 * - Service down → throws ServiceUnavailableException
 * - 404 / not found → returns null / false
 */
@Injectable()
export class ConversationServiceAdapter implements IConversationService {
  constructor(
    @Inject(SERVICES.CONVERSATION) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  /** Send an RPC call with circuit-breaker protection when CB is available,
   *  or plain RxJS timeout when it is not. */
  private async call<T = any>(pattern: object, payload: any): Promise<T> {
    if (this.circuitBreaker) {
      try {
        return await this.circuitBreaker.execute(
          // retries=0: avoid retry storms on the hot message-send path.
          // Each retry adds up to 3000 ms inside the outer gateway→chat-core budget.
          // halfOpenAfter=5000: recover in 5 s instead of the default 30 s so
          // that a transient spike doesn't stall the async BRPOP workers for 30 s.
          { serviceName: 'conversation-service', timeout: 3000, retries: 0, halfOpenAfter: 5000 },
          () => firstValueFrom(this.client.send(pattern, payload)),
        );
      } catch (error: any) {
        if (
          error?.name === 'BrokenCircuitError' ||
          error?.name === 'TaskCancelledError'
        ) {
          throw new ServiceUnavailableException(
            ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
            'conversation-service unavailable',
          );
        }
        throw error;
      }
    }
    return firstValueFrom(
      this.client.send(pattern, payload).pipe(timeout(3000)),
    );
  }

  async getConversation(
    conversationId: string,
  ): Promise<ConversationDto | null> {
    try {
      const result = await this.call(
        CONVERSATION_PATTERNS.FIND_BY_ID,
        { conversationId },
      );
      if (!result) return null;
      return parseResponse(
        ConversationDtoSchema,
        result,
        'ConversationServiceAdapter.getConversation',
      );
    } catch (error: any) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException(
          ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
          'conversation-service unavailable',
        );
      }
      // 404 from conversation-service means the conversation genuinely doesn't exist
      if ((error?.statusCode ?? error?.status) === 404) {
        return null;
      }
      // Rethrow unexpected errors instead of silently returning null.
      // Returning null when the service actually had an error causes the
      // caller to misclassify the failure as "conversation not found" (404)
      // instead of a transient service error (503).
      throw new ServiceUnavailableException(
        ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
        'conversation-service unavailable',
      );
    }
  }

  async getConversationsByIds(
    conversationIds: string[],
  ): Promise<Map<string, ConversationDto>> {
    try {
      // Note: Current implementation doesn't have batch get, fallback to individual calls
      const promises = conversationIds.map((id) => this.getConversation(id));
      const results = await Promise.all(promises);

      const map = new Map<string, ConversationDto>();
      results.forEach((conv, index) => {
        if (conv) {
          map.set(conversationIds[index], conv);
        }
      });

      return map;
    } catch (error) {
      return new Map();
    }
  }

  async createConversation(
    dto: CreateConversationDto,
  ): Promise<ConversationDto> {
    const result = await firstValueFrom(
      this.client.send(CONVERSATION_PATTERNS.CREATE_CONVERSATION, dto),
    );
    return parseResponse(
      ConversationDtoSchema,
      result,
      'ConversationServiceAdapter.createConversation',
    );
  }

  async createDirectConversation(
    userAId: string,
    userBId: string,
  ): Promise<ConversationDto> {
    const dto: CreateConversationDto = {
      type: 'direct',
      createdBy: userAId,
      initialMembers: [
        { userId: userAId, role: 'OWNER' },
        { userId: userBId, role: 'OWNER' },
      ],
    };

    return this.createConversation(dto);
  }

  async getMembership(
    userId: string,
    conversationId: string,
  ): Promise<MembershipResult> {
    try {
      // Single TCP call: fetch all members once and derive isMember locally.
      // Previously this issued IS_MEMBER (SELECT COUNT) + getMembers (SELECT *) —
      // two DB round-trips per cache miss. Now: one GET_MEMBERS_WITH_ROLES call,
      // isMember determined in-process. Cuts per-miss DB load by 50%.
      const members = await this.getMembers(conversationId);
      const membership = members.find((m) => m.userId === userId);

      if (!membership) {
        return { isMember: false };
      }

      return {
        isMember: true,
        role: membership.role,
        membership,
      };
    } catch (error: any) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException(
          ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
          'conversation-service unavailable',
        );
      }
      // Rethrow instead of silently returning {isMember: false}
      throw error;
    }
  }

  async isMember(userId: string, conversationId: string): Promise<boolean> {
    try {
      const result = await this.call(
        CONVERSATION_PATTERNS.IS_MEMBER,
        { userId, conversationId },
      );
      if (typeof result === 'boolean') {
        return result;
      }
      return result?.isMember === true;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException(
          ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
          'conversation-service unavailable',
        );
      }
      throw new ServiceUnavailableException(
        ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
        'conversation-service unavailable',
      );
    }
  }

  async getMembers(conversationId: string): Promise<MembershipDto[]> {
    try {
      const result = await this.call(
        CONVERSATION_PATTERNS.GET_MEMBERS_WITH_ROLES,
        { conversationId },
      );

      // Support multiple response envelopes from conversation-service/gateway
      const rawMembers = Array.isArray(result)
        ? result
        : Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result?.members)
            ? result.members
            : Array.isArray(result?.data?.members)
              ? result.data.members
              : [];

      return rawMembers
        .map((m: any) => ({
          userId: m?.userId ?? m?.id ?? m?.keycloakId,
          conversationId: m?.conversationId ?? conversationId,
          role: m?.role ?? 'member', // fallback matches lowercase MemberRole enum
          joinedAt: m?.joinedAt ? new Date(m.joinedAt) : new Date(),
          addedBy: m?.addedBy,
        }))
        .filter((m: MembershipDto) => !!m.userId);
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException(
          ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
          'conversation-service unavailable',
        );
      }
      // Rethrow instead of swallowing as empty array
      throw new ServiceUnavailableException(
        ERROR_CODES.CONVERSATION_SERVICE_UNAVAILABLE,
        'conversation-service unavailable',
      );
    }
  }

  async addMember(
    conversationId: string,
    userId: string,
    role: string,
    addedBy: string,
  ): Promise<MembershipDto> {
    const result = await firstValueFrom(
      this.client.send(CONVERSATION_PATTERNS.ADD_MEMBERS, {
        conversationId,
        userIds: [userId],
        role,
        addedBy,
      }),
    );

    return {
      userId,
      conversationId,
      role,
      joinedAt: new Date(),
      addedBy,
    };
  }

  async removeMember(
    conversationId: string,
    userId: string,
    removedBy: string,
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client.send(CONVERSATION_PATTERNS.REMOVE_MEMBERS, {
          conversationId,
          userIds: [userId],
          removedBy,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async archiveConversation(
    conversationId: string,
    archivedBy: string,
  ): Promise<boolean> {
    try {
      // Note: Archive functionality may need to be added to conversation service
      // For now, this is a placeholder
      return false;
    } catch (error) {
      return false;
    }
  }
}
