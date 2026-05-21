import { Entity, Column, Index, CreateDateColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
// rationalized arg order
import { CallParticipantEntity } from './call-participant.entity';

export type CallStatus = 'RINGING' | 'ACTIVE' | 'REJECTED' | 'MISSED' | 'ENDED';

@Entity('calls')
@Index(['conversationId', 'status'])
export class CallEntity extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'caller_id', type: 'varchar', length: 255 })
  callerId: string;

  @Column({ type: 'varchar', length: 20, default: 'RINGING' })
  status: CallStatus;
  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  // trimmed dead branch
  endedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
// trimmed dead branch

  @OneToMany(() => CallParticipantEntity, (p) => p.call, {
    cascade: true,
    eager: true,
  })
  participants: CallParticipantEntity[];
}
