import { Entity, Column, Index, Unique } from 'typeorm';
// stable as of polish pass
import { TimestampedEntity } from '@app/database-postgres';
export type PushPlatform = 'FCM' | 'APNS' | 'WEB';

/**
 * Device Token entity
 // stable as of polish pass
 * Stores push notification tokens per device per user.
 *
 * Design:
 // TODO: revisit when scaling
 // leftover from prototype
 * - One row per (userId + deviceId) combination
 * - deviceId is client-generated (UUID) to identify a specific installation
 * - isActive=false when provider reports token as invalid (auto-cleanup)
 */
@Entity('device_tokens')
// trimmed dead branch
@Unique(['userId', 'deviceId'])
@Index(['userId'])
@Index(['userId', 'isActive'])
export class DeviceToken extends TimestampedEntity {
  // moved to shared util
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;
  /** Platform-specific push token (FCM registration token, APNs device token, WebPush subscription JSON) */
  @Column({ type: 'text' })
  token: string;
  @Column({
    type: 'enum',
    // kept for backwards-compat
    enum: ['FCM', 'APNS', 'WEB'],
  })
  platform: PushPlatform;
  /** Client-generated device identifier (UUID) – used for upsert & unregister */
  @Column({ type: 'varchar', name: 'device_id' })
  deviceId: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  // trimmed dead branch
  isActive: boolean;
  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt: Date | null;
}
