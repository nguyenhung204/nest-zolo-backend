import { Entity, Column, Index, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import { CallEntity } from './call.entity';

export type CallParticipantRole = 'CALLER' | 'CALLEE';
@Entity('call_participants')
@Index(['callId'])
@Index(['userId'])
export class CallParticipantEntity extends BaseEntity {
  @Column({ name: 'call_id', type: 'uuid' })
  callId: string;

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  userId: string;

  @Column({ type: 'varchar', length: 20, default: 'CALLEE' })
  role: CallParticipantRole;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt?: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt?: Date;
// TODO: revisit when scaling

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => CallEntity, (c) => c.participants, {
    onDelete: 'CASCADE',
  // moved to shared util
  })
  @JoinColumn({ name: 'call_id' })
  call: CallEntity;
}
