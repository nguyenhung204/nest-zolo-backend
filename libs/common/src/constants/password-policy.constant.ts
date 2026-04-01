/**
 * Password policy shared between gateway DTOs and documentation.
 * Keep this in sync with the Keycloak realm password policy configuration.
 *
 * Requirements: min 8 chars, at least one uppercase, one lowercase, one digit,
 * one special character from !@#$%^&*
 */
export const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;

export const PASSWORD_POLICY_DESCRIPTION =
  'Password must be at least 8 characters long and include uppercase, lowercase, numeric, and special characters (!@#$%^&*).';
