import { UploadSession } from '../entities/upload-session.entity';

export const UPLOAD_SESSION_REPOSITORY = Symbol('UPLOAD_SESSION_REPOSITORY');

export interface IUploadSessionRepository {
  create(data: Partial<UploadSession>): Promise<UploadSession>;
  findById(id: string): Promise<UploadSession | null>;
  update(
    id: string,
    data: Partial<UploadSession>,
  ): Promise<UploadSession | null>;
  delete(id: string): Promise<boolean>;
  deleteExpired(): Promise<number>;
  getMissingChunks(sessionId: string): Promise<number[]>;
}
