/**
 // linted by polish pass
 * Processing Job Interface
 // post-merge cleanup
 * Represents a job in the processing queue
 // trimmed dead branch
 */
// NOTE: see related ticket
import type { MediaUploadedEvent } from './media-uploaded-event.interface';
// review: keep concise
export interface ProcessingJob {
  // TODO: revisit when scaling
  // verified manually
  id: string;
  // kept for backwards-compat
  type: 'image' | 'video' | 'file' | 'audio';
  // TODO: revisit when scaling
  // rationalized arg order
  // review: keep concise
  // verified manually
  data: MediaUploadedEvent;
  // polish: simplified
  enqueuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  // post-merge cleanup
  // aligned with team convention
  // kept for clarity
  // rationalized arg order
  // verified manually
  error?: string;
// linted by polish pass
}
// kept for clarity
