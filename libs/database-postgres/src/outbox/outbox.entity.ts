import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum OutboxStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('outbox_events')
@Index(['status', 'createdAt']) // For fast claiming: WHERE status='pending' ORDER BY created_at
@Index(['status', 'lockedAt']) // For fast requeuing: WHERE status='processing' AND locked_at < timeout
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'aggregate_type', type: 'varchar' })
  @Index()
  aggregateType: string; // e.g., 'conversation', 'friendship'

  @Column({ name: 'aggregate_id', type: 'varchar' })
  aggregateId: string;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string; // e.g., 'member.added', 'friend.request.sent'

  @Column('jsonb')
  payload: Record<string, any>;

  @Column({
    type: 'enum',
    enum: OutboxStatus,
    default: OutboxStatus.PENDING,
  })
  @Index()
  status: OutboxStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'kafka_topic', type: 'varchar', nullable: true })
  kafkaTopic?: string | null;

  @Column({ name: 'kafka_key', type: 'varchar', nullable: true })
  kafkaKey?: string | null;

  @Column({ name: 'locked_by', type: 'varchar', nullable: true })
  lockedBy?: string | null; // Instance ID that claimed this event

  @Column({ name: 'locked_at', type: 'timestamp', nullable: true })
  lockedAt?: Date | null; // When the event was claimed

  /**
   * Idempotency key — set by the producer to prevent duplicate events.
   * The DB UNIQUE constraint ensures the same business operation cannot create
   * two outbox rows even if the calling transaction is retried.
   * NULL values are treated as distinct (standard PostgreSQL behaviour).
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true, unique: true })
  idempotencyKey?: string | null;

  /**
   * Earliest time this event should next be retried.
   * Set by markAsFailed() with exponential backoff. claimPendingEvents() skips
   * events where next_retry_at > NOW(), preventing retry storms.
   */
  @Column({ name: 'next_retry_at', type: 'timestamp', nullable: true })
  nextRetryAt?: Date | null;
}
