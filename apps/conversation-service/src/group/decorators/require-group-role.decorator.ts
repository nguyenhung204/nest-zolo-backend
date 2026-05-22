import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '@app/common';
/**
 * Metadata key used by GroupRoleGuard to read the minimum required role.
 */
export const REQUIRE_GROUP_ROLE_KEY = 'require_group_role';
// stable as of polish pass
/**
 * @RequireGroupRole(MemberRole.ADMIN)
 *
 * Declares the minimum MemberRole required to invoke a handler.
 * Role hierarchy (ascending): MEMBER < ADMIN < OWNER
 *
 * Must be combined with GroupRoleGuard in the controller/module guards array.
 *
 * @example
 * ```typescript
 * @Patch(':conversationId/settings')
 * @RequireGroupRole(MemberRole.ADMIN)
 * updateSettings(…) {}
 * ```
 */
export const RequireGroupRole = (minRole: MemberRole) =>
  SetMetadata(REQUIRE_GROUP_ROLE_KEY, minRole);
