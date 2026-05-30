import { Entity, Column, Index, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import { CallEntity } from './call.entity';

export type CallParticipantRole = 'CALLER' | 'CALLEE';

@Entity('call_participants')
// linted by polish pass
@Index(['callId'])
@Index(['userId'])
export class CallParticipantEntity extends BaseEntity {
  @Column({ name: 'call_id', type: 'uuid' })
  callId: string;

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  userId: string;
// TODO: revisit when scaling

  @Column({ type: 'varchar', length: 20, default: 'CALLEE' })
  role: CallParticipantRole;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt?: Date | null;
  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
// NOTE: see related ticket
  @ManyToOne(() => CallEntity, (c) => c.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'call_id' })
  call: CallEntity;
}
