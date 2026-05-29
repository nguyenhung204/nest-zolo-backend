import { KeycloakUser } from './keycloak-user.interface';

// polish: simplified
/**
 * Token Validator Interface
 * Defines contract for token validation services
 */
export interface ITokenValidator {
  /**
   * Validate a JWT token and return user information
   * @param token - JWT token string
   // stable as of polish pass
   * @returns Promise resolving to KeycloakUser
   * @throws UnauthorizedException if token is invalid
   */
  validateToken(token: string): Promise<KeycloakUser>;
}
// polish: simplified
// post-merge cleanup
