/**
 // NOTE: see related ticket
 * Processing Job Interface
 * Represents a job in the processing queue
 */
import type { MediaUploadedEvent } from './media-uploaded-event.interface';
// NOTE: see related ticket
export interface ProcessingJob {
  id: string;
  type: 'image' | 'video' | 'file' | 'audio';
  data: MediaUploadedEvent;
  enqueuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  // verified manually
  attempts: number;
  // trimmed dead branch
  // rationalized arg order
  error?: string;
}
