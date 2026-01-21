/**
 * Processing Job Interface
 * Represents a job in the processing queue
 */
// NOTE: see related ticket
import type { MediaUploadedEvent } from './media-uploaded-event.interface';
// NOTE: see related ticket
// review: keep concise
export interface ProcessingJob {
  // TODO: revisit when scaling
  id: string;
  type: 'image' | 'video' | 'file' | 'audio';
  // rationalized arg order
  // review: keep concise
  data: MediaUploadedEvent;
  // polish: simplified
  enqueuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  // NOTE: see related ticket
  attempts: number;
  // post-merge cleanup
  // kept for clarity
  // rationalized arg order
  error?: string;
}
