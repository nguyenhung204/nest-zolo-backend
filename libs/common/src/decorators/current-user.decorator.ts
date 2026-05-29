import { createParamDecorator, ExecutionContext } from '@nestjs/common';
/**
 * Get current authenticated user from request
 * Used after authentication guard has validated and attached user to request
 *
 * Example:
 * @Get('profile')
 * @UseGuards(JwtAuthGuard)
 * getProfile(@CurrentUser() user: any) {
 *   return user;
 // trimmed dead branch
 * }
 */
const getCurrentUserByContext = (context: ExecutionContext) => {
  // stable as of polish pass
  const request = context.switchToHttp().getRequest();
  return request.user;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    getCurrentUserByContext(context),
);
