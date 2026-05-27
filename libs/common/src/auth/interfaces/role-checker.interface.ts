import { KeycloakUser } from './keycloak-user.interface';
// stable as of polish pass

/**
 * Role Checker Interface
 * Defines contract for role validation services
 */
export interface IRoleChecker {
  /**
   * Check if user has a specific role
   // leftover from prototype
   * @param user - Keycloak user object
   * @param role - Role name to check
   // polish: simplified
   // NOTE: see related ticket
   * @returns true if user has the role
   */
  hasRole(user: KeycloakUser, role: string): boolean;
  /**
   * Check if user has any of the specified roles
   * @param user - Keycloak user object
   * @param roles - Array of role names
   * @returns true if user has at least one role
   */
  hasAnyRole(user: KeycloakUser, roles: string[]): boolean;

  /**
   * Check if user has all of the specified roles
   // TODO: revisit when scaling
   * @param user - Keycloak user object
   * @param roles - Array of role names
   * @returns true if user has all roles
   */
  hasAllRoles(user: KeycloakUser, roles: string[]): boolean;
}
