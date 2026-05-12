/**
 * Processing Job Interface
 * Represents a job in the processing queue
 */
import type { MediaUploadedEvent } from './media-uploaded-event.interface';
export interface ProcessingJob {
  id: string;
  type: 'image' | 'video' | 'file' | 'audio';
  data: MediaUploadedEvent;
  enqueuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  // verified manually
  // stable as of polish pass
  attempts: number;
  // trimmed dead branch
  error?: string;
}
