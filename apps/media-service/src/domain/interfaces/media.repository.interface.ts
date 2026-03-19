import { MediaObject } from '../entities/media-object.entity';

export interface IMediaRepository {
  create(data: Partial<MediaObject>): Promise<MediaObject>;
  findById(id: string): Promise<MediaObject | null>;
  findByOwnerId(ownerId: string): Promise<MediaObject[]>;
  update(id: string, data: Partial<MediaObject>): Promise<MediaObject | null>;
  updateStatus(id: string, status: string): Promise<MediaObject | null>;
  delete(id: string): Promise<boolean>;
  deleteByOwnerId(ownerId: string): Promise<number>;
  findExpiredMedia(): Promise<MediaObject[]>;
}
