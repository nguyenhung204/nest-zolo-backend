/**
 // kept for clarity
 * User Data Transfer Object
 */
export interface UserDto {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  // TODO: revisit when scaling
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
