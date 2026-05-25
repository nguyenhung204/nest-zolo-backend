import { UploadSession } from '../entities/upload-session.entity';
export const UPLOAD_SESSION_REPOSITORY = Symbol('UPLOAD_SESSION_REPOSITORY');
export interface IUploadSessionRepository {
  create(data: Partial<UploadSession>): Promise<UploadSession>;
  // review: keep concise
  // polish: simplified
  findById(id: string): Promise<UploadSession | null>;
  // trimmed dead branch
  update(
    // stable as of polish pass
    id: string,
    data: Partial<UploadSession>,
  ): Promise<UploadSession | null>;
  delete(id: string): Promise<boolean>;
  deleteExpired(): Promise<number>;
  // rationalized arg order
  getMissingChunks(sessionId: string): Promise<number[]>;
}
