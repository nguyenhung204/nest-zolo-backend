import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@app/database-postgres';
import type { MessageAttachment } from '../interfaces';

/**
 * Message Entity - Phase 3
 *
 * Read-only storage for messages
 * Written by MessageStore consumer, read by API
 *
 * All messages have offset for ordering and pagination
 */
@Entity('messages')
@Index(['conversationId', 'createdAt'])
@Index(['senderId'])
export class Message extends BaseEntity {
  @Column({ name: 'conversation_id' })
  @Index()
  conversationId!: string;

  @Column({ name: 'sender_id' })
  senderId!: string;

  /**
   * Message content text.
   * Nullable for media-only messages (image, video, audio, file, sticker)
   */
  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ type: 'varchar', length: 50, default: 'text' })
  type!: string; // 'text', 'image', 'file', 'audio', 'video', 'sticker'

  /**
   * Offset field for ALL conversations
   * - Sequential number assigned by MessageStore on persist
   * - Unique within each conversation (per conversationId)
   * - Used for:
   *   1. Message ordering (ORDER BY offset ASC)
   *   2. Pagination (after/before offset)
   *   3. Unread calculation
   * - Assigned atomically via Conversation.maxOffset increment
   */
  @Column({ type: 'bigint' })
  @Index()
  offset!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  /**
   * Attachments array - up to 30 media items per message (images, video, files).
   * Replaces legacy single `attachment` column (backfilled via migration 20).
   */
  @Column({ type: 'jsonb', nullable: true })
  attachments?: MessageAttachment[];

  /**
   * Flag for message requests (DIRECT conversation with strangers)
   * - true: Message from stranger (not friends, receiver hasn't replied)
   * - false: Normal inbox message
   * - Used for UI to display "Message Requests" folder
   */
  @Column({ name: 'is_message_request', default: false })
  @Index()
  isMessageRequest!: boolean;

  @Column({ name: 'is_edited', default: false })
  isEdited!: boolean;

  @Column({ name: 'edited_at', type: 'timestamp', nullable: true })
  editedAt?: Date;

  @Column({ name: 'is_deleted', default: false })
  isDeleted!: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date;

  // ── Revoke (tombstone, both parties) ────────────────────────────────────────
  @Column({ name: 'is_revoked', default: false })
  isRevoked!: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date;

  @Column({ name: 'revoked_by', type: 'varchar', length: 64, nullable: true })
  revokedBy?: string;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 128, nullable: true })
  revokeReason?: string;

  @Column({ name: 'revoke_version', type: 'int', default: 0 })
  revokeVersion!: number;

  // ── Forward reference ────────────────────────────────────────────────────────
  @Column({ name: 'forwarded_from_message_id', type: 'uuid', nullable: true })
  forwardedFromMessageId?: string;

  // ── Reply reference ───────────────────────────────────────────────────────────
  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId?: string;

  @Column({ name: 'forwarded_from_conversation_id', type: 'uuid', nullable: true })
  forwardedFromConversationId?: string;

  @Column({ name: 'forwarded_from_sender_id', type: 'varchar', length: 64, nullable: true })
  forwardedFromSenderId?: string;

  @Column({ name: 'forwarded_at', type: 'timestamptz', nullable: true })
  forwardedAt?: Date;

  @Column({ name: 'forward_snapshot', type: 'jsonb', nullable: true })
  forwardSnapshot?: {
    text?: string;                   // Up to 80-char preview of original text
    type: string;                    // Message type of original
    thumbUrl?: string;               // Thumbnail if original was media
    metadata?: Record<string, any>;  // Preserved for contact_card (contactUserId, etc.)
  };

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /**
   * Serialize message for API response
   * For deleted messages, hide sensitive data but keep senderId for UI positioning
   */
  toJSON() {
    // Revoked (tombstone): keep bubble visible, hide content for both parties
    if (this.isRevoked) {
      return {
        id: this.id,
        conversationId: this.conversationId,
        senderId: this.senderId,
        offset: this.offset,
        type: this.type,
        isRevoked: true,
        revokedAt: this.revokedAt,
        tombstoneTextKey: 'message.revoked',
        createdAt: this.createdAt,
      };
    }

    if (this.isDeleted) {
      // Globally deleted: only return minimal info + senderId (for UI left/right positioning)
      return {
        id: this.id,
        conversationId: this.conversationId,
        senderId: this.senderId,
        offset: this.offset,
        type: this.type,
        isDeleted: true,
        deletedAt: this.deletedAt,
        createdAt: this.createdAt,
      };
    }

    // Normal message: return all fields
    return {
      id: this.id,
      conversationId: this.conversationId,
      senderId: this.senderId,
      content: this.content,
      type: this.type,
      offset: this.offset,
      metadata: this.metadata,
      mentions: Array.isArray(this.metadata?.mentions)
        ? this.metadata.mentions
        : undefined,
      attachments: this.attachments,
      isMessageRequest: this.isMessageRequest,
      isEdited: this.isEdited,
      editedAt: this.editedAt,
      isDeleted: this.isDeleted,
      deletedAt: this.deletedAt,
      replyToId: this.replyToId,
      // Forward metadata (only present on forwarded messages)
      ...(this.forwardedFromMessageId && {
        forwardedFrom: {
          messageId: this.forwardedFromMessageId,
          conversationId: this.forwardedFromConversationId,
          senderId: this.forwardedFromSenderId,
          forwardedAt: this.forwardedAt,
          snapshot: this.forwardSnapshot,
        },
      }),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
