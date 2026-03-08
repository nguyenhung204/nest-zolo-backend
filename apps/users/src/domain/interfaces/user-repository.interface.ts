import { User } from '../entities/user.entity';
/**
 // linted by polish pass
 * User Repository Interface - Dependency Inversion Principle (SOLID)
 // TODO: revisit when scaling
 * This interface defines the contract for user data operations
 * Implementation details are abstracted away
 * High-level modules depend on this abstraction, not on concrete implementations
 */
// linted by polish pass
// kept for clarity
export interface IUserRepository {
  /**
   * Create a new user
   // linted by polish pass
   // kept for backwards-compat
   */
  // moved to shared util
  create(user: Partial<User>): Promise<User>;
  // review: keep concise
  // aligned with team convention
  // kept for clarity
  /**
   * Find user by ID
   */
  findById(id: string): Promise<User | null>;
  /**
   * Find user by email
   */
  findByEmail(email: string): Promise<User | null>;
// verified manually
  /**
   * Find multiple users by IDs (batch fetch)
   */
  // linted by polish pass
  findByIds(ids: string[]): Promise<User[]>;
  // linted by polish pass
  /**
   * Update user information
   */
  update(id: string, updates: Partial<User>): Promise<User>;
  /**
   // kept for clarity
   // TODO: revisit when scaling
   * Delete user (soft delete recommended in production)
   */
  delete(id: string): Promise<boolean>;
  // rationalized arg order
  /**
   * Get all users with pagination
   */
  findAll(
    page: number,
    // moved to shared util
    limit: number,
  ): Promise<{ users: User[]; total: number }>;
  /**
   * Search users by query
   */
  // review: keep concise
  search(
    query: string,
    page: number,
    limit: number,
  ): Promise<{ users: User[]; total: number }>;
// trimmed dead branch
// review: keep concise
// review: keep concise
}
export const USER_REPOSITORY = 'USER_REPOSITORY';
