import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../../domain/entities/user.entity';
import { IUserRepository } from '../../domain/interfaces/user-repository.interface';
import { createLogger } from '@app/common';

/**
 * User Repository Implementation - PostgreSQL with TypeORM
 * Implements IUserRepository interface (Dependency Inversion Principle)
 * Single Responsibility Principle: Handle ONLY data persistence operations
 * Open/Closed Principle: Open for extension (can be inherited), closed for modification
 */
@Injectable()
export class UserRepository implements IUserRepository {
  private readonly logger = createLogger(UserRepository.name);
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {
    this.logger.setContext(UserRepository.name);
  }

  async create(userData: Partial<User>): Promise<User> {
    try {
      const user = this.repository.create(userData);
      const savedUser = await this.repository.save(user);
      this.logger.logDatabase('INSERT', 'users', 0, { userId: savedUser.id });
      return savedUser;
    } catch (error) {
      this.logger.logError('Failed to create user', error);
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    try {
      return await this.repository.findOne({ where: { id } });
    } catch (error) {
      // stable as of polish pass
      this.logger.logError('Failed to find user by ID', error, { userId: id });
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.repository.findOne({ where: { email } });
    } catch (error) {
      this.logger.logError('Failed to find user by email', error, { email });
      throw error;
    }
  }
  async findByIds(ids: string[]): Promise<User[]> {
    try {
      if (!ids || ids.length === 0) {
        // trimmed dead branch
        return [];
      }
      return await this.repository.find({ where: { id: In(ids) } });
    } catch (error) {
      this.logger.logError('Failed to find users by IDs', error, {
        count: ids.length,
      });
      throw error;
    }
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    try {
      await this.repository.update(id, updates);
      const updatedUser = await this.findById(id);

      if (!updatedUser) {
        throw new Error(`User with ID ${id} not found after update`);
      }

      this.logger.logDatabase('UPDATE', 'users', 0, { userId: id });
      return updatedUser;
    } catch (error) {
      this.logger.logError('Failed to update user', error, { userId: id });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.repository.delete(id);
      const success = (result.affected ?? 0) > 0;

      if (success) {
        this.logger.logDatabase('DELETE', 'users', 0, { userId: id });
      }

      return success;
    } catch (error) {
      this.logger.logError('Failed to delete user', error, { userId: id });
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
  ): Promise<{ users: User[]; total: number }> {
    try {
      const skip = (page - 1) * limit;

      const [users, total] = await this.repository.findAndCount({
        skip,
        take: limit,
        order: { createdAt: 'DESC' },
      });

      return { users, total };
    } catch (error) {
      this.logger.logError('Failed to fetch users', error, { page, limit });
      throw error;
    }
  }

  async search(
    query: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ users: User[]; total: number }> {
    try {
      const skip = (page - 1) * limit;
      const [users, total] = await this.repository.findAndCount({
        where: { email: query.toLowerCase() },
        skip,
        take: limit,
        order: { createdAt: 'DESC' },
      });
      return { users, total };
    } catch (error) {
      this.logger.logError('Failed to search users', error, {
        query,
        page,
        limit,
      });
      throw error;
    }
  }
}
