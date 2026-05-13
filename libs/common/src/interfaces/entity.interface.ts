/**
 * Base entity interface - All entities must have an ID
 */
export interface IEntity {
  _id?: string | any;
  id?: string | any;
}

/**
 * Entity with timestamps
 */
export interface ITimestampedEntity extends IEntity {
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Soft deletable entity
 */
export interface ISoftDeletableEntity extends ITimestampedEntity {
  deletedAt?: Date | null;
  isDeleted?: boolean;
}
