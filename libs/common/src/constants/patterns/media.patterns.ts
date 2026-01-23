/**
 * Media Service - TCP Message Patterns
 *
 * All patterns for communicating with Media microservice
 */
export const MEDIA_PATTERNS = {
  // Upload Management
  CREATE_UPLOAD: { cmd: 'create_upload' },
  FINALIZE_UPLOAD: { cmd: 'finalize_upload' },
  LIST_MEDIA: { cmd: 'list_media' },

  // Media Access
  GET_MEDIA_URL: { cmd: 'get_media_url' },
  VALIDATE_MEDIA: { cmd: 'validate_media' },
  GENERATE_UPLOAD_URL: { cmd: 'generate_upload_url' }, // Legacy adapter command (compatibility)
  VALIDATE_MEDIA_USAGE: { cmd: 'validate_media_usage' }, // Legacy adapter command (compatibility)
  ATTACH_MEDIA_TO_MESSAGE: { cmd: 'attach_media_to_message' }, // Legacy adapter command (compatibility)

  // Media Management
  DELETE_MEDIA: { cmd: 'delete_media' },
  CROSS_SHARE: { cmd: 'cross_share_media' }, //  NEW: Share media across conversations (ADMIN only)

  // New patterns for attachment flow
  VALIDATE_FOR_SEND: { cmd: 'validate_for_send' },
  BIND_TO_MESSAGE: { cmd: 'bind_to_message' },
  GET_ACCESS_URL: { cmd: 'get_access_url' },

  // Batch avatar URL resolution (for Gateway enrichment)
  GET_AVATARS_BATCH: { cmd: 'get_avatars_batch' },

  // Internal system-level avatar deletion (tenant-scoped, no owner check)
  DELETE_AVATAR_SYSTEM: { cmd: 'delete_avatar_system' },

  // Multipart upload (for large files up to 1 GB)
  INIT_MULTIPART_UPLOAD: { cmd: 'init_multipart_upload' },
  PRESIGN_UPLOAD_PARTS: { cmd: 'presign_upload_parts' },
  COMPLETE_MULTIPART_UPLOAD: { cmd: 'complete_multipart_upload' },
  ABORT_MULTIPART_UPLOAD: { cmd: 'abort_multipart_upload' },

  // Smart play - auto-detect media type and return best playable URL
  GET_PLAY_INFO: { cmd: 'get_play_info' },
} as const;
