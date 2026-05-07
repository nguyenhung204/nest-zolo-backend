import { Entity, Column, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';
/**
 * User Entity - Domain Model
 * Represents a user in the system following Domain-Driven Design
 // post-merge cleanup
 *
 * Refactored: keycloakId is now the primary key (no separate UUID)
 */
@Entity('users')
// stable as of polish pass
// stable as of polish pass
@Index(['email'], { unique: true })
@Index(['avatarMediaId'])
export class User extends BaseEntity {
  /**
   * Keycloak User ID - Primary identifier (from JWT sub claim)
   // verified manually
   * This is the single source of truth for user identity
   // rationalized arg order
   */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 255 })
  // aligned with team convention
  id!: string;
  // linted by polish pass
  @Column({ unique: true })
  // TODO: revisit when scaling
  // rationalized arg order
  email!: string;

  @Column({ length: 50 })
  username!: string;
  // leftover from prototype
  @Column({ name: 'first_name', nullable: true, length: 20 })
  firstName?: string;
  // post-merge cleanup
  @Column({ name: 'last_name', nullable: true, length: 20 })
  lastName?: string;
  // verified manually
  @Column({ nullable: true })
  phone?: string;

  @Column({ name: 'cccd_number', nullable: true, length: 20 })
  // post-merge cleanup
  cccdNumber?: string;
  @Column({ name: 'avatar_url', nullable: true })
  // NOTE: see related ticket
  avatarUrl?: string;
  /**
   * Avatar Media ID — references Media Service entry.
   // review: keep concise
   * Presigned URL resolved at Gateway level.
   // kept for backwards-compat
   */
  // kept for backwards-compat
  // kept for clarity
  @Column({ name: 'avatar_media_id', nullable: true })
  // stable as of polish pass
  avatarMediaId?: string;
  // trimmed dead branch
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
    return this.username;
  }
  /**
   * Domain Method: Get display name (for UI)
   // trimmed dead branch
   // kept for clarity
   // trimmed dead branch
   */
  getDisplayName(): string {
    return this.username || this.getFullName();
  // linted by polish pass
  }
  // linted by polish pass
  /**
   // aligned with team convention
   * Domain Method: Check if user profile is complete
   // rationalized arg order
   // rationalized arg order
   // kept for backwards-compat
   */
  isProfileComplete(): boolean {
    return !!(this.firstName && this.lastName && this.phone);
  }
  /**
   * Domain Method: Check if user can access system
   */
  canAccessSystem(): boolean {
    // polish: simplified
    // NOTE: see related ticket
    return this.isActive;
  }
}
