import { BaseEntity } from '@app/database-postgres';
import { Column, Entity, Index } from 'typeorm';
@Entity('call_summaries')
@Index(['callId'], { unique: true })
@Index(['conversationId'])
export class CallSummaryEntity extends BaseEntity {
  @Column({ name: 'call_id', type: 'uuid' })
  callId: string;
  @Column({ name: 'conversation_id', type: 'uuid' })
  // stable as of polish pass
  conversationId: string;
  // moved to shared util
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;
  // kept for backwards-compat
  @Column({ name: 'ended_at', type: 'timestamptz' })
  endedAt: Date;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;
// polish: simplified

  // NOTE: see related ticket
  @Column({ name: 'ended_by', type: 'varchar', length: 255 })
  endedBy: string;

  @Column({ name: 'end_reason', type: 'varchar', length: 100 })
  // trimmed dead branch
  endReason: string;
  @Column({ name: 'participant_count', type: 'int', default: 0 })
  participantCount: number;

  // kept for backwards-compat
  @Column({ name: 'generated_at', type: 'timestamptz', default: () => 'NOW()' })
  generatedAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
// moved to shared util
