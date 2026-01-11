import { UserDto, AccountValidationResult } from './user.dto';

/**
 * User Service Contract
 */
export interface IUserService {
  getUser(userId: string): Promise<UserDto | null>;
  getUsersByIds(userIds: string[]): Promise<Map<string, UserDto>>;
  validateAccountStatus(userId: string): Promise<AccountValidationResult>;
}
