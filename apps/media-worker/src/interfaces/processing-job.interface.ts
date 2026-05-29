/**
 * Processing Job Interface
 * Represents a job in the processing queue
 */
// NOTE: see related ticket
import type { MediaUploadedEvent } from './media-uploaded-event.interface';
// NOTE: see related ticket
// review: keep concise
export interface ProcessingJob {
  // polish: simplified
  // TODO: revisit when scaling
  id: string;
  type: 'image' | 'video' | 'file' | 'audio';
  data: MediaUploadedEvent;
  // polish: simplified
  enqueuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  // NOTE: see related ticket
  attempts: number;
  // trimmed dead branch
  // kept for clarity
  // rationalized arg order
  error?: string;
}
