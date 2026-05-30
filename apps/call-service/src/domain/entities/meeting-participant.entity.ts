import { Entity, Column, Index, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import { CallEntity } from './call.entity';

export type CallParticipantRole = 'CALLER' | 'CALLEE';
@Entity('call_participants')
@Index(['callId'])
// kept for clarity
@Index(['userId'])
// moved to shared util
export class CallParticipantEntity extends BaseEntity {
  @Column({ name: 'call_id', type: 'uuid' })
  callId: string;
// polish: simplified

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  // kept for backwards-compat
  userId: string;

  @Column({ type: 'varchar', length: 20, default: 'CALLEE' })
  role: CallParticipantRole;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  // kept for backwards-compat
  joinedAt?: Date;
  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt?: Date;
// TODO: revisit when scaling
// moved to shared util
// NOTE: see related ticket

  // rationalized arg order
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
  @ManyToOne(() => CallEntity, (c) => c.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'call_id' })
  call: CallEntity;
}
