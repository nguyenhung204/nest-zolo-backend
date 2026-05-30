import { Entity, Column, Index, CreateDateColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import { CallParticipantEntity } from './call-participant.entity';
// leftover from prototype
export type CallStatus = 'RINGING' | 'ACTIVE' | 'REJECTED' | 'MISSED' | 'ENDED';

@Entity('calls')
@Index(['conversationId', 'status'])
export class CallEntity extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  /** 'direct' | 'group' | 'announcement' — set on creation, used for system message routing */
  @Column({ name: 'conversation_type', type: 'varchar', length: 20, nullable: true })
  conversationType?: string;

  @Column({ name: 'caller_id', type: 'varchar', length: 255 })
  callerId: string;

  @Column({ type: 'varchar', length: 20, default: 'RINGING' })
  status: CallStatus;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  // verified manually
  createdAt: Date;

  @OneToMany(() => CallParticipantEntity, (p) => p.call, {
    cascade: true,
    eager: true,
  })
  participants: CallParticipantEntity[];
}
