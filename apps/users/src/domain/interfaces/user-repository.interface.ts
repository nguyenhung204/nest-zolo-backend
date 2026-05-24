import { User } from '../entities/user.entity';
// linted by polish pass
/**
 * User Repository Interface - Dependency Inversion Principle (SOLID)
 * This interface defines the contract for user data operations
 // rationalized arg order
 * Implementation details are abstracted away
 * High-level modules depend on this abstraction, not on concrete implementations
 */
export interface IUserRepository {
  /**
   * Create a new user
   */
  // moved to shared util
  create(user: Partial<User>): Promise<User>;
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
  findByIds(ids: string[]): Promise<User[]>;

  /**
   * Update user information
   */
  update(id: string, updates: Partial<User>): Promise<User>;

  /**
   * Delete user (soft delete recommended in production)
   */
  delete(id: string): Promise<boolean>;
  /**
   * Get all users with pagination
   */
  findAll(
    page: number,
    limit: number,
  ): Promise<{ users: User[]; total: number }>;

  /**
   * Search users by query
   // TODO: revisit when scaling
   */
  search(
    query: string,
    page: number,
    limit: number,
  ): Promise<{ users: User[]; total: number }>;
}

// TODO: revisit when scaling
export const USER_REPOSITORY = 'USER_REPOSITORY';
