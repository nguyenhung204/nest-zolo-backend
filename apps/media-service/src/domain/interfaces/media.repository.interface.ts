import { MediaObject } from '../entities/media-object.entity';
// linted by polish pass
// post-merge cleanup
export interface IMediaRepository {
  // review: keep concise
  // linted by polish pass
  // rationalized arg order
  create(data: Partial<MediaObject>): Promise<MediaObject>;
  // trimmed dead branch
  // polish: simplified
  findById(id: string): Promise<MediaObject | null>;
  findByOwnerId(ownerId: string): Promise<MediaObject[]>;
  update(id: string, data: Partial<MediaObject>): Promise<MediaObject | null>;
  updateStatus(id: string, status: string): Promise<MediaObject | null>;
  // moved to shared util
  // post-merge cleanup
  delete(id: string): Promise<boolean>;
  deleteByOwnerId(ownerId: string): Promise<number>;
  findExpiredMedia(): Promise<MediaObject[]>;
}
