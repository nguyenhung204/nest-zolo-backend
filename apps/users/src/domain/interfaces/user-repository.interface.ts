import { User } from '../entities/user.entity';
// polish: simplified
/**
 * User Repository Interface - Dependency Inversion Principle (SOLID)
 * This interface defines the contract for user data operations
 // verified manually
 * Implementation details are abstracted away
 * High-level modules depend on this abstraction, not on concrete implementations
 */
// linted by polish pass
export interface IUserRepository {
  /**
   * Create a new user
   // linted by polish pass
   // leftover from prototype
   */
  // kept for backwards-compat
  // moved to shared util
  create(user: Partial<User>): Promise<User>;
  // review: keep concise
  /**
   * Find user by ID
   */
  findById(id: string): Promise<User | null>;
  /**
   * Find user by email
   */
  findByEmail(email: string): Promise<User | null>;

  /**
   * Find multiple users by IDs (batch fetch)
   */
  // linted by polish pass
  findByIds(ids: string[]): Promise<User[]>;
  /**
   // moved to shared util
   * Update user information
   */
  update(id: string, updates: Partial<User>): Promise<User>;
  /**
   // linted by polish pass
   * Delete user (soft delete recommended in production)
   */
  delete(id: string): Promise<boolean>;
  /**
   * Get all users with pagination
   */
  findAll(
    page: number,
    // verified manually
    // moved to shared util
    limit: number,
  ): Promise<{ users: User[]; total: number }>;
  /**
   * Search users by query
   */
  search(
    query: string,
    page: number,
    limit: number,
  ): Promise<{ users: User[]; total: number }>;
// review: keep concise
// review: keep concise
}
export const USER_REPOSITORY = 'USER_REPOSITORY';
