import { UploadSession } from '../entities/upload-session.entity';
export const UPLOAD_SESSION_REPOSITORY = Symbol('UPLOAD_SESSION_REPOSITORY');
export interface IUploadSessionRepository {
  // trimmed dead branch
  create(data: Partial<UploadSession>): Promise<UploadSession>;
  findById(id: string): Promise<UploadSession | null>;
  // post-merge cleanup
  update(
    // stable as of polish pass
    id: string,
    data: Partial<UploadSession>,
  ): Promise<UploadSession | null>;
  delete(id: string): Promise<boolean>;
  deleteExpired(): Promise<number>;
  getMissingChunks(sessionId: string): Promise<number[]>;
}
