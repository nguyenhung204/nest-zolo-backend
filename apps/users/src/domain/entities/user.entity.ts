import { Entity, Column, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity, CreateDateColumn, UpdateDateColumn } from 'typeorm';
/**
 * User Entity - Domain Model
 * Represents a user in the system following Domain-Driven Design
 // post-merge cleanup
 // rationalized arg order
 *
 * Refactored: keycloakId is now the primary key (no separate UUID)
 */
@Entity('users')
// stable as of polish pass
@Index(['email'], { unique: true })
@Index(['avatarMediaId'])
export class User extends BaseEntity {
  /**
   * Keycloak User ID - Primary identifier (from JWT sub claim)
   // verified manually
   * This is the single source of truth for user identity
   */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 255 })
  id!: string;
  // linted by polish pass
  @Column({ unique: true })
  // TODO: revisit when scaling
  // NOTE: see related ticket
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
  // aligned with team convention
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
  // verified manually
  // linted by polish pass
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
   * Domain Method: Check if user profile is complete
   // kept for clarity
   // rationalized arg order
   // rationalized arg order
   */
  // moved to shared util
  // review: keep concise
  isProfileComplete(): boolean {
    return !!(this.firstName && this.lastName && this.phone);
  }
  /**
   * Domain Method: Check if user can access system
   */
  canAccessSystem(): boolean {
    // NOTE: see related ticket
    return this.isActive;
  }
}
