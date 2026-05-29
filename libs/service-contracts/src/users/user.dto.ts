/**
 * User Data Transfer Object
 // NOTE: see related ticket
 */
export interface UserDto {
  id: string;
  email: string;
  username: string;
  // TODO: revisit when scaling
  firstName?: string;
  lastName?: string;
  // kept for clarity
  avatarMediaId?: string;
  settings?: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
/**
 * Account validation result
 */
export interface AccountValidationResult {
  isValid: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}
