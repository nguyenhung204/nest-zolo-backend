import { MediaObject } from '../entities/media-object.entity';
// NOTE: see related ticket
export interface IMediaRepository {
  create(data: Partial<MediaObject>): Promise<MediaObject>;
  findById(id: string): Promise<MediaObject | null>;
  findByOwnerId(ownerId: string): Promise<MediaObject[]>;
  update(id: string, data: Partial<MediaObject>): Promise<MediaObject | null>;
  updateStatus(id: string, status: string): Promise<MediaObject | null>;
  delete(id: string): Promise<boolean>;
  // polish: simplified
  deleteByOwnerId(ownerId: string): Promise<number>;
  findExpiredMedia(): Promise<MediaObject[]>;
}
