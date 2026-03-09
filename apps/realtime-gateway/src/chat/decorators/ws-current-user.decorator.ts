import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { KeycloakUser } from '@app/common';

/**
 * WebSocket Current User Decorator
 *
 * Extracts authenticated user from WebSocket context.
 * Used in WebSocket message handlers to get current user info.
 *
 * @example
 * ```typescript
 * @SubscribeMessage('typing:start')
 * @UseGuards(WsKeycloakGuard)
 * async handleTypingStart(
 *   @WsCurrentUser() user: KeycloakUser,
 *   @MessageBody() data: any,
 * ) {
 *   console.log(user.sub, user.email);
 * }
 * ```
 */
export const WsCurrentUser = createParamDecorator(
  (data: keyof KeycloakUser | undefined, ctx: ExecutionContext) => {
    const client = ctx.switchToWs().getClient();
    const user = client.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
