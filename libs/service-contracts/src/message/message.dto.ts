/**
 * Message Data Transfer Object
 */
export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string; // 'text' | 'media' | 'file' | 'voice' | 'video'
  mediaId?: string;
  metadata?: MessageMetadata;
  attachments?: MessageAttachmentDto[];
  replyToId?: string;
  mentions?: string[];
  createdAt: Date;
  updatedAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
  deletedBy?: string;
}

/**
 * Message metadata
 */
export interface MessageMetadata {
  editCount?: number;
  reactions?: Record<string, string[]>; // emoji -> userId[]
  isPinned?: boolean;
  pinnedBy?: string;
  pinnedAt?: Date;
  [key: string]: any;
}

export interface MessageAttachmentDto {
  mediaId: string;
  kind?: 'image' | 'video' | 'audio' | 'file';
  type?: string;
  status?: string;
  prefer?: 'ORIGINAL' | 'OPTIMIZED';
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  thumb?: {
    mediaId?: string;
    url?: string;
    ready?: boolean;
  };
  thumbUrl?: string;
  variantsReady?: boolean;
  meta?: {
    width?: number;
    height?: number;
    durationMs?: number;
  };
  variants?: Array<{
    kind: string;
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

/**
 * Message edit history
 */
export interface MessageHistoryDto {
  messageId: string;
  version: number;
  content: string;
  editedBy: string;
  editedAt: Date;
}
