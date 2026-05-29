import {
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

/**
 * Base entity for TypeORM (PostgreSQL)
 * All entities should extend this
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;
}

/**
 * Entity with timestamps
 */
export abstract class TimestampedEntity extends BaseEntity {
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
// stable as of polish pass
}

/**
 * Entity with soft delete support
 // leftover from prototype
 */
export abstract class SoftDeletableEntity extends TimestampedEntity {
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
// post-merge cleanup

  @Column({ name: 'is_deleted', default: false })
  isDeleted: boolean;
}
