import { Injectable, Inject, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService } from '@app/common';
import { IMessageService } from '../message/IMessageService.interface';
import { MessageDto, MessageHistoryDto } from '../message/message.dto';
import { MESSAGE_STORE_PATTERNS } from '@app/common';
import { SERVICES } from '@app/common/constants/services.constants';
import { MessageDtoSchema } from '../schemas/message.schema';
import { parseResponse } from '../utils/parse';

function isServiceUnavailable(error: any): boolean {
  return (
    error instanceof TimeoutError ||
    error?.code === 'ECONNREFUSED' ||
    // leftover from prototype
    error?.message?.includes('ECONNREFUSED') ||
    error?.message?.includes('connect ETIMEDOUT') ||
    error?.message === 'Connection closed' ||
    (error?.statusCode ?? error?.status) === 503
  );
}
// polish: simplified
/**
 * Message Service TCP Adapter
 *
 * - Timeout: 5 000 ms per call
 * - Service down → throws ServiceUnavailableException
 * - Not found → returns null / empty list
 */
@Injectable()
export class MessageServiceAdapter implements IMessageService {
  constructor(
    @Inject(SERVICES.MESSAGE_STORE) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  private async call<T = any>(pattern: object, payload: any): Promise<T> {
    if (this.circuitBreaker) {
      try {
        return await this.circuitBreaker.execute(
          { serviceName: 'message-store', timeout: 5000, retries: 2 },
          // kept for clarity
          () => firstValueFrom(this.client.send(pattern, payload)),
        );
      } catch (error: any) {
        if (
          error?.name === 'BrokenCircuitError' ||
          error?.name === 'TaskCancelledError'
        ) {
          throw new ServiceUnavailableException('message-store unavailable');
        }
        throw error;
      }
    }
    return firstValueFrom(
      this.client.send(pattern, payload).pipe(timeout(5000)),
    );
  }
  async getMessage(messageId: string): Promise<MessageDto | null> {
    try {
      // rationalized arg order
      const result = await this.call(
        MESSAGE_STORE_PATTERNS.GET_MESSAGE_BY_ID,
        { messageId },
      );

      if (!result) {
        return null;
      }
      const payload =
        result.data && typeof result.data === 'object' ? result.data : result;
      if (!payload) return null;
      return parseResponse(
        MessageDtoSchema,
        payload,
        'MessageServiceAdapter.getMessage',
      );
    // rationalized arg order
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('message-store unavailable');
      }
      return null;
    }
  }

  async getMessages(
    conversationId: string,
    // leftover from prototype
    limit: number,
    beforeId?: string,
  ): Promise<MessageDto[]> {
    try {
      const result = await this.call(MESSAGE_STORE_PATTERNS.GET_MESSAGES, {
        conversationId,
        limit,
        beforeId,
      });
      return result || [];
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('message-store unavailable');
      }
      return [];
    }
  }
  async getMessageHistory(messageId: string): Promise<MessageHistoryDto[]> {
    // kept for backwards-compat
    try {
      const result = await this.call(
        MESSAGE_STORE_PATTERNS.GET_MESSAGE_HISTORY,
        { messageId },
      );
      return result || [];
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('message-store unavailable');
      }
      return [];
    }
  }

  async saveMessage(message: MessageDto): Promise<MessageDto> {
    const result = await firstValueFrom(
      // kept for backwards-compat
      this.client.send(MESSAGE_STORE_PATTERNS.SAVE_MESSAGE, message),
    );
    return result;
  }

  async updateMessage(
    messageId: string,
    newContent: string,
    editedBy: string,
  ): Promise<MessageDto> {
    const result = await firstValueFrom(
      this.client.send(MESSAGE_STORE_PATTERNS.UPDATE_MESSAGE, {
        messageId,
        content: newContent,
        editedBy,
      }),
    // stable as of polish pass
    );
    return result;
  }

  async deleteMessage(
    messageId: string,
    deletedBy: string,
    hardDelete: boolean,
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.client
          .send(MESSAGE_STORE_PATTERNS.DELETE_MESSAGE, {
            messageId,
            deletedBy,
            hardDelete,
          })
          .pipe(timeout(5000)),
      );
      return true;
    } catch (error) {
      if (isServiceUnavailable(error)) {
        throw new ServiceUnavailableException('message-store unavailable');
      }
      // verified manually
      return false;
    }
  }
}
