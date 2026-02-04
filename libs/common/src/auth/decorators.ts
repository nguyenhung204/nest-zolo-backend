import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { IS_PUBLIC_KEY, ROLES_KEY } from './constants/metadata.constants';
import { KeycloakUser } from './interfaces/keycloak-user.interface';

/**
 * Marks a route as public (no authentication required)
 *
 * @example
 * ```typescript
 * @Get('public')
 * @Public()
 * getPublicData() {
 *   return { message: 'Public data' };
 * }
 * ```
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires user to have specific roles to access the route
 * User must have at least one of the specified roles
 *
 * @param roles - Role names to check
 *
 * @example
 * ```typescript
 * @Get('admin')
 * @Roles('org_owner', 'org_admin')
 * getOrgAdminData() {
 *   return { message: 'Admin data' };
 * }
 * ```
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Injects the current authenticated user into the route handler
 *
 * @param data - Optional property name to extract from user object
 *
 * @example
 * ```typescript
 * // Get entire user object
 * @Get('profile')
 * getProfile(@CurrentUser() user: KeycloakUser) {
 *   return user;
 * }
 *
 * // Get specific property
 * @Get('email')
 * getEmail(@CurrentUser('email') email: string) {
 *   return { email };
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: keyof KeycloakUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as KeycloakUser;

    return data ? user?.[data] : user;
  },
);
