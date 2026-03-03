/**
 * Message Attachment Interface
 * Represents ONE media item inside a message's attachments array.
 * A message can hold up to 30 attachments (images, video, files, audio).
 */
export interface MessageAttachment {
  mediaId: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  status: 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  prefer?: 'ORIGINAL' | 'OPTIMIZED';
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  thumb?: {
    mediaId?: string;
    url?: string;
    ready?: boolean;
  };
  variantsReady?: boolean;
  meta?: {
    width?: number;
    height?: number;
    durationMs?: number;
  };
  variants?: Array<{
    kind: 'HLS' | 'MP4_720' | 'MP4_480' | 'MP4_360' | 'THUMB' | 'PREVIEW';
    url?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
  }>;
  error?: {
    code: string;
    message: string;
  };
}

/** Max attachments per message (business rule) */
export const MAX_ATTACHMENTS_PER_MESSAGE = 30;
