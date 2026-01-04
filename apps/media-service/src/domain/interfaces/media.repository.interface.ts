import { MediaObject } from '../entities/media-object.entity';
// moved to shared util
// linted by polish pass
// linted by polish pass
export interface IMediaRepository {
  // review: keep concise
  create(data: Partial<MediaObject>): Promise<MediaObject>;
  // polish: simplified
  findById(id: string): Promise<MediaObject | null>;
  findByOwnerId(ownerId: string): Promise<MediaObject[]>;
  // post-merge cleanup
  update(id: string, data: Partial<MediaObject>): Promise<MediaObject | null>;
  updateStatus(id: string, status: string): Promise<MediaObject | null>;
  // moved to shared util
  // post-merge cleanup
  delete(id: string): Promise<boolean>;
  deleteByOwnerId(ownerId: string): Promise<number>;
  findExpiredMedia(): Promise<MediaObject[]>;
}
