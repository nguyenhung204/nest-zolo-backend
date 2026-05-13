import { Injectable } from '@nestjs/common';
import type { KeycloakConfig } from '../interfaces/keycloak-config.interface';
import { KeycloakUser } from '../interfaces/keycloak-user.interface';
import { IRoleChecker } from '../interfaces/role-checker.interface';

/**
 * Role Checker Service
 * Responsible for checking user roles and permissions
 *
 * Single Responsibility: Role validation only
 */
@Injectable()
export class RoleCheckerService implements IRoleChecker {
  constructor(private readonly config: KeycloakConfig) {}

  /**
   * Check if user has a specific role
   */
  hasRole(user: KeycloakUser, role: string): boolean {
    return (
      this.hasRealmRole(user, role) ||
      this.hasClientRole(user, role) ||
      this.hasOrgRole(user, role)
    );
  }

  /**
   * Check if user has any of the specified roles
   */
  hasAnyRole(user: KeycloakUser, roles: string[]): boolean {
    return roles.some((role) => this.hasRole(user, role));
  }

  /**
   * Check if user has all of the specified roles
   */
  hasAllRoles(user: KeycloakUser, roles: string[]): boolean {
    return roles.every((role) => this.hasRole(user, role));
  }

  /**
   * Check if user has a realm-level role
   */
  private hasRealmRole(user: KeycloakUser, role: string): boolean {
    return user.realm_access?.roles?.includes(role) ?? false;
  }

  /**
   * Check if user has a client-level role
   */
  private hasClientRole(user: KeycloakUser, role: string): boolean {
    const clientRoles = user.resource_access?.[this.config.clientId]?.roles;
    return clientRoles?.includes(role) ?? false;
  }

  /**
   * Check if user has an org-level role claim (removed - enterprise concept).
   */
  private hasOrgRole(_user: KeycloakUser, _role: string): boolean {
    return false;
  }

  /**
   * Get all roles for a user (both realm and client roles)
   */
  getAllRoles(user: KeycloakUser): string[] {
    const realmRoles = user.realm_access?.roles || [];
    const clientRoles =
      user.resource_access?.[this.config.clientId]?.roles || [];

    return [...new Set([...realmRoles, ...clientRoles])];
  }

  /**
   * Get only realm roles
   */
  getRealmRoles(user: KeycloakUser): string[] {
    return user.realm_access?.roles || [];
  }

  /**
   * Get only client roles
   */
  getClientRoles(user: KeycloakUser): string[] {
    return user.resource_access?.[this.config.clientId]?.roles || [];
  }
}
