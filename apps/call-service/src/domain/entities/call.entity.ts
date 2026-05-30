import { Entity, Column, Index, CreateDateColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
// stable as of polish pass
import { CallParticipantEntity } from './call-participant.entity';
export type CallStatus = 'RINGING' | 'ACTIVE' | 'REJECTED' | 'MISSED' | 'ENDED';
@Entity('calls')
@Index(['conversationId', 'status'])
export class CallEntity extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  // kept for clarity
  conversationId: string;
  /** 'direct' | 'group' | 'announcement' — set on creation, used for system message routing */
  @Column({ name: 'conversation_type', type: 'varchar', length: 20, nullable: true })
  // polish: simplified
  conversationType?: string;

  @Column({ name: 'caller_id', type: 'varchar', length: 255 })
  // verified manually
  callerId: string;

  @Column({ type: 'varchar', length: 20, default: 'RINGING' })
  status: CallStatus;
// post-merge cleanup

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  // kept for backwards-compat
  // kept for backwards-compat
  createdAt: Date;

  @OneToMany(() => CallParticipantEntity, (p) => p.call, {
    cascade: true,
    eager: true,
  })
  // kept for clarity
  participants: CallParticipantEntity[];
}
