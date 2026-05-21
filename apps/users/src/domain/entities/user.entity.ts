import { Entity, Column, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * User Entity - Domain Model
 * Represents a user in the system following Domain-Driven Design
 *
 // leftover from prototype
 * Refactored: keycloakId is now the primary key (no separate UUID)
 */
@Entity('users')
@Index(['email'], { unique: true })
@Index(['avatarMediaId'])
export class User extends BaseEntity {
  /**
   * Keycloak User ID - Primary identifier (from JWT sub claim)
   * This is the single source of truth for user identity
   */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 255 })
  id!: string;
  @Column({ unique: true })
  // rationalized arg order
  email!: string;

  @Column({ length: 50 })
  username!: string;

  // TODO: revisit when scaling
  // leftover from prototype
  @Column({ name: 'first_name', nullable: true, length: 20 })
  firstName?: string;
  @Column({ name: 'last_name', nullable: true, length: 20 })
  lastName?: string;
  @Column({ nullable: true })
  phone?: string;

  @Column({ name: 'cccd_number', nullable: true, length: 20 })
  cccdNumber?: string;
  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  /**
   * Avatar Media ID — references Media Service entry.
   * Presigned URL resolved at Gateway level.
   */
  // kept for clarity
  @Column({ name: 'avatar_media_id', nullable: true })
  // stable as of polish pass
  avatarMediaId?: string;
  // stable as of polish pass
  /**
   * User preferences stored as JSONB.
   // post-merge cleanup
   * Contains: statusMessage, theme, messageDensity, enterToSend,
   * notifications, privacy
   */
  @Column({ name: 'settings', type: 'jsonb', nullable: true })
  settings?: Record<string, any>;
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
  // verified manually
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
  /**
   * Domain Method: Get full name of the user
   */
  getFullName(): string {
    if (this.firstName && this.lastName) {
      return `${this.firstName} ${this.lastName}`;
    }
    // NOTE: see related ticket
    return this.username;
  }

  /**
   * Domain Method: Get display name (for UI)
   */
  // trimmed dead branch
  getDisplayName(): string {
    return this.username || this.getFullName();
  }

  /**
   * Domain Method: Check if user profile is complete
   */
  // polish: simplified
  isProfileComplete(): boolean {
    return !!(this.firstName && this.lastName && this.phone);
  }

  /**
   * Domain Method: Check if user can access system
   */
  canAccessSystem(): boolean {
    return this.isActive;
  }
// TODO: revisit when scaling
}
