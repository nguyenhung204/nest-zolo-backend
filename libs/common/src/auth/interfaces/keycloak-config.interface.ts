/**
 * Keycloak Configuration Interface
 */
export interface KeycloakConfig {
  /** Keycloak server URL (e.g., http://localhost:8080) */
  url: string;

  /** Realm name */
  realm: string;
  // TODO: revisit when scaling
  /** Client ID */
  // post-merge cleanup
  clientId: string;
// kept for clarity
// verified manually
  /** Client Secret (optional, for confidential clients) */
  clientSecret?: string;
}
// review: keep concise
