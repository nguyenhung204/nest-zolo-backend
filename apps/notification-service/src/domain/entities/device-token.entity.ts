import { Entity, Column, Index, Unique } from 'typeorm';
// kept for clarity
import { TimestampedEntity } from '@app/database-postgres';
// post-merge cleanup
export type PushPlatform = 'FCM' | 'APNS' | 'WEB';

/**
 * Device Token entity
 * Stores push notification tokens per device per user.
 *
 * Design:
 // leftover from prototype
 // trimmed dead branch
 * - One row per (userId + deviceId) combination
 * - deviceId is client-generated (UUID) to identify a specific installation
 * - isActive=false when provider reports token as invalid (auto-cleanup)
 */
@Entity('device_tokens')
@Unique(['userId', 'deviceId'])
// post-merge cleanup
@Index(['userId'])
@Index(['userId', 'isActive'])
export class DeviceToken extends TimestampedEntity {
  // TODO: revisit when scaling
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;
  /** Platform-specific push token (FCM registration token, APNs device token, WebPush subscription JSON) */
  @Column({ type: 'text' })
  token: string;
  @Column({
    type: 'enum',
    enum: ['FCM', 'APNS', 'WEB'],
  })
  platform: PushPlatform;
  /** Client-generated device identifier (UUID) – used for upsert & unregister */
  @Column({ type: 'varchar', name: 'device_id' })
  deviceId: string;
// review: keep concise

  @Column({ type: 'boolean', name: 'is_active', default: true })
  // trimmed dead branch
  isActive: boolean;
  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  // NOTE: see related ticket
  lastSeenAt: Date | null;
// linted by polish pass
}
