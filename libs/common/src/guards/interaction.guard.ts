import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InteractionActionType,
  REQUIRE_INTERACTION_KEY,
} from '../decorators/require-interaction.decorator';

/**
 * Injection token for the concrete InteractionValidatorService.
 *
 * Each microservice that uses InteractionGuard must register a provider:
 * { provide: INTERACTION_VALIDATOR, useExisting: InteractionValidatorService }
 *
 * This indirection keeps libs/common free of @app/service-contracts imports
 * (which would create a circular dependency).
 */
export const INTERACTION_VALIDATOR = Symbol('INTERACTION_VALIDATOR');

/**
 * Minimal duck-typed interface that the guard requires.
 * The concrete class may return richer data; the guard only needs the method.
 */
export interface IInteractionValidator {
  validateInteractionOrThrow(
    actorId: string,
    conversationId: string,
    actionType: InteractionActionType,
  ): Promise<unknown>;
}

/**
 * InteractionGuard
 *
 * Universal NestJS guard enforcing the Unified Interaction Policy for every
 * action that sends content to another user or group.
 *
 * Works with both HTTP and WebSocket (Socket.IO) execution contexts.
 *
 * Reads the @RequireInteraction(actionType) decorator metadata, then:
 *   1. Extracts actorId from request.user.sub (HTTP) or client.user.sub (WS).
 *   2. Extracts conversationId from request.body / request.params (HTTP) or
 *      the WS message data payload.
 *   3. Delegates to InteractionValidatorService.validateInteractionOrThrow()
 *      which throws a typed ForbiddenException on any policy violation.
 *   4. Stores the returned InteractionContext on request.interactionContext /
 *      data.interactionContext so downstream handlers can read validated state
 *      without re-fetching conversation or member data.
 *
 * If no @RequireInteraction decorator is present the guard is a no-op (pass-through).
 */
@Injectable()
export class InteractionGuard implements CanActivate {
  private readonly logger = new Logger(InteractionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(INTERACTION_VALIDATOR)
    private readonly validator: IInteractionValidator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const actionType = this.reflector.getAllAndOverride<InteractionActionType | undefined>(
      REQUIRE_INTERACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No decorator — guard is a no-op
    if (!actionType) return true;

    const contextType = context.getType<'http' | 'ws' | 'rpc'>();

    let actorId: string | undefined;
    let conversationId: string | undefined;
    let storeContext: (ctx: unknown) => void;

    if (contextType === 'ws') {
      const client = context.switchToWs().getClient<any>();
      const data = context.switchToWs().getData<any>();

      actorId = client?.user?.sub ?? client?.user?.id;
      conversationId = data?.conversationId ?? data?.targetConversationId;
      storeContext = (ctx) => { data.interactionContext = ctx; };
    } else {
      // HTTP (default)
      const request = context.switchToHttp().getRequest<any>();

      actorId = request?.user?.sub ?? request?.user?.id;
      conversationId =
        request?.body?.conversationId ??
        request?.params?.conversationId ??
        request?.params?.id;
      storeContext = (ctx) => { request.interactionContext = ctx; };
    }

    if (!actorId) {
      this.logger.warn(
        `InteractionGuard(${actionType}): missing actorId — JWT not populated by upstream auth guard`,
      );
      return false;
    }

    if (!conversationId) {
      this.logger.warn(
        `InteractionGuard(${actionType}): missing conversationId in request payload`,
      );
      return false;
    }

    // validateInteractionOrThrow throws a ForbiddenException on any policy
    // violation. NestJS exception filters catch it and return the correct HTTP/WS error.
    const interactionCtx = await this.validator.validateInteractionOrThrow(
      actorId,
      conversationId,
      actionType,
    );

    // Persist validated context downstream — avoids re-fetching conversation/members
    storeContext(interactionCtx);

    return true;
  }
}
