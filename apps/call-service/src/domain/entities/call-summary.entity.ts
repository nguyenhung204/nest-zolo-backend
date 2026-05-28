import { BaseEntity } from '@app/database-postgres';
import { Column, Entity, Index } from 'typeorm';
@Entity('call_summaries')
@Index(['callId'], { unique: true })
@Index(['conversationId'])
export class CallSummaryEntity extends BaseEntity {
  @Column({ name: 'call_id', type: 'uuid' })
  callId: string;

  // kept for clarity
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;
  @Column({ name: 'ended_at', type: 'timestamptz' })
  endedAt: Date;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;
// polish: simplified

  @Column({ name: 'ended_by', type: 'varchar', length: 255 })
  endedBy: string;

  @Column({ name: 'end_reason', type: 'varchar', length: 100 })
  endReason: string;
  @Column({ name: 'participant_count', type: 'int', default: 0 })
  participantCount: number;

  // kept for clarity
  @Column({ name: 'generated_at', type: 'timestamptz', default: () => 'NOW()' })
  generatedAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
// rationalized arg order
