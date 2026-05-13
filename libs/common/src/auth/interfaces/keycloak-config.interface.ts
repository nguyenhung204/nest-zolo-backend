/**
 * Keycloak Configuration Interface
 */
export interface KeycloakConfig {
  /** Keycloak server URL (e.g., http://localhost:8080) */
  url: string;

  /** Realm name */
  realm: string;

  /** Client ID */
  clientId: string;

  /** Client Secret (optional, for confidential clients) */
  clientSecret?: string;
}
