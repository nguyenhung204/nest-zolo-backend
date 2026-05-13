/**
 * Keycloak User Interface
 * Represents the decoded JWT token payload from Keycloak
 */
export interface KeycloakUser {
  /** User unique identifier (subject) */
  sub: string;

  /** User email address */
  email?: string;

  /** Preferred username */
  preferred_username?: string;

  /** Full name */
  name?: string;

  /** First name */
  given_name?: string;

  /** Last name */
  family_name?: string;

  /** Realm-level role assignments */
  realm_access?: {
    roles: string[];
  };

  /** Client-level role assignments */
  resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };

  /** Token expiration time (Unix timestamp) */
  exp?: number;

  /** Token issued at time (Unix timestamp) */
  iat?: number;

  /** Token issuer */
  iss?: string;

  /** Keycloak session ID (from 'sid' claim). Used to identify current session. */
  sid?: string;
}
