import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getKeycloakConfig } from '../config';
import { KeycloakUser } from './interfaces/keycloak-user.interface';
import { ITokenValidator } from './interfaces/token-validator.interface';
import { IRoleChecker } from './interfaces/role-checker.interface';
import { TokenValidationService } from './services/token-validation.service';
import { RoleCheckerService } from './services/role-checker.service';

/**
 * Keycloak Service (Facade Pattern)
 *
 * Provides a unified interface to the authentication subsystem
 * Delegates to specialized services following Single Responsibility Principle
 * Uses ConfigService for configuration (no process.env)
 */
@Injectable()
export class KeycloakService implements ITokenValidator, IRoleChecker {
  private roleChecker: RoleCheckerService;

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenValidator: TokenValidationService,
  ) {
    const config = getKeycloakConfig(configService);
    this.roleChecker = new RoleCheckerService(config);
  }

  /**
   * Validate JWT token and return user information
   * Delegates to TokenValidationService
   */
  async validateToken(token: string): Promise<KeycloakUser> {
    return this.tokenValidator.validateToken(token);
  }

  /**
   * Check if user has a specific role
   * Delegates to RoleCheckerService
   */
  hasRole(user: KeycloakUser, role: string): boolean {
    return this.roleChecker.hasRole(user, role);
  }

  /**
   * Check if user has any of the specified roles
   * Delegates to RoleCheckerService
   */
  hasAnyRole(user: KeycloakUser, roles: string[]): boolean {
    return this.roleChecker.hasAnyRole(user, roles);
  }

  /**
   * Check if user has all of the specified roles
   * Delegates to RoleCheckerService
   */
  hasAllRoles(user: KeycloakUser, roles: string[]): boolean {
    return this.roleChecker.hasAllRoles(user, roles);
  }

  /**
   * Get all roles for a user
   */
  getAllRoles(user: KeycloakUser): string[] {
    return this.roleChecker.getAllRoles(user);
  }
}
