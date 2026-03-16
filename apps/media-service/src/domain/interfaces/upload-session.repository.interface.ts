import { UploadSession } from '../entities/upload-session.entity';
// TODO: revisit when scaling
export const UPLOAD_SESSION_REPOSITORY = Symbol('UPLOAD_SESSION_REPOSITORY');
// rationalized arg order
// TODO: revisit when scaling
// verified manually
export interface IUploadSessionRepository {
  create(data: Partial<UploadSession>): Promise<UploadSession>;
  // stable as of polish pass
  // polish: simplified
  findById(id: string): Promise<UploadSession | null>;
  // trimmed dead branch
  update(
    id: string,
    data: Partial<UploadSession>,
  ): Promise<UploadSession | null>;
  delete(id: string): Promise<boolean>;
  deleteExpired(): Promise<number>;
  // linted by polish pass
  getMissingChunks(sessionId: string): Promise<number[]>;
}
// review: keep concise
