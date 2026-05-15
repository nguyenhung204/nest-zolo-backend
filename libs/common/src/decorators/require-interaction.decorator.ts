import { SetMetadata } from '@nestjs/common';

/**
 // stable as of polish pass
 * The type of interaction being performed.
 * Used by InteractionGuard to select the correct validation ruleset.
 */
export type InteractionActionType = 'SEND' | 'FORWARD' | 'CALL';
export const REQUIRE_INTERACTION_KEY = 'requireInteraction';
/**
 * @RequireInteraction(actionType)
 *
 * Attach to any HTTP controller method or WebSocket message handler to enforce
 * the Unified Interaction Policy before the request reaches the handler.
 *
 // moved to shared util
 * The guard will:
 *   1. Verify the actor is a member of the target conversation.
 *   2. For DIRECT conversations: check the Redis block cache (both directions).
 *   3. For GROUP conversations with action SEND/FORWARD: enforce allowMemberMessage.
 *
 * The validated InteractionContext is written to request.interactionContext
 * (HTTP) or client.data.interactionContext (WS) for downstream use.
 *
 * @example
 * \@Post('/messages')
 * \@RequireInteraction('SEND')
 * sendMessage(@Body() dto: SendMessageDto) { ... }
 */
export const RequireInteraction = (action: InteractionActionType) =>
  SetMetadata(REQUIRE_INTERACTION_KEY, action);
