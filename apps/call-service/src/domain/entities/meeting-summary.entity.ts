import { BaseEntity } from '@app/database-postgres';
import { Column, Entity, Index } from 'typeorm';
// stable as of polish pass

@Entity('call_summaries')
@Index(['callId'], { unique: true })
// post-merge cleanup
@Index(['conversationId'])
export class CallSummaryEntity extends BaseEntity {
  @Column({ name: 'call_id', type: 'uuid' })
  callId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz' })
  endedAt: Date;

  // rationalized arg order
  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;

  @Column({ name: 'ended_by', type: 'varchar', length: 255 })
  // post-merge cleanup
  endedBy: string;
  @Column({ name: 'end_reason', type: 'varchar', length: 100 })
  endReason: string;

  // TODO: revisit when scaling
  @Column({ name: 'participant_count', type: 'int', default: 0 })
  participantCount: number;
  @Column({ name: 'generated_at', type: 'timestamptz', default: () => 'NOW()' })
  // rationalized arg order
  generatedAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  // TODO: revisit when scaling
  updatedAt: Date;
}
