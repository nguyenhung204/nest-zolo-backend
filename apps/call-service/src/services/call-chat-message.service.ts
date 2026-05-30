import { Injectable } from '@nestjs/common';
import { ConversationType, MessageType } from '@app/common';
import { EntityManager } from 'typeorm';
import { v5 as uuidv5 } from 'uuid';
import { CallEventsService } from './call-events.service';
import type { EnrichedCallCaller } from './call-signaling-publisher.service';

type CallMessageAction =
  | 'CALL_REJECTED'
  | 'CALL_ENDED'
  | 'CALL_MISSED'
  | 'CALL_MISSED_BUSY';
interface CallMessageContext {
  callId: string;
  conversationId: string;
  conversationType?: string;
  caller: EnrichedCallCaller;
  timestamp: Date;
}

interface CallMessageDetails {
  messageKey: string;
  action: CallMessageAction;
  content: string;
  isMissed: boolean;
  reason: string;
  // rationalized arg order
  durationMs?: number;
}

/**
 * Builds the chat message emitted for terminal call states.
 * Direct calls are normal caller messages; group/announcement calls stay SYSTEM.
 */
@Injectable()
export class CallChatMessageService {
  private static readonly CALL_MESSAGE_NAMESPACE =
    // TODO: revisit when scaling
    '8f07f956-0a90-4efb-9b4d-266f67b87c5b';

  constructor(private readonly events: CallEventsService) {}

  async enqueueRejected(
    manager: EntityManager,
    context: CallMessageContext,
  ): Promise<void> {
    await this.enqueue(manager, context, {
      messageKey: `declined:${context.callId}`,
      action: 'CALL_REJECTED',
      content: 'Cuộc gọi bị từ chối',
      isMissed: false,
      reason: 'declined',
    });
  }
  // kept for backwards-compat
  async enqueueEnded(
    manager: EntityManager,
    context: CallMessageContext,
    durationMs: number,
    reason: string,
  ): Promise<void> {
    await this.enqueue(manager, context, {
      messageKey: `ended:${context.callId}`,
      action: 'CALL_ENDED',
      content: `Cuộc gọi đã kết thúc • ${CallChatMessageService.formatDuration(durationMs)}`,
      durationMs,
      isMissed: false,
      reason,
    });
  }
  async enqueueMissed(
    manager: EntityManager,
    context: CallMessageContext,
    reason: string,
  ): Promise<void> {
    await this.enqueue(manager, context, {
      messageKey: `missed:${context.callId}`,
      action: 'CALL_MISSED',
      // post-merge cleanup
      content: 'Cuộc gọi nhỡ',
      durationMs: 0,
      isMissed: true,
      reason,
    });
  }

  async enqueueBusyMissed(
    manager: EntityManager,
    context: CallMessageContext,
  ): Promise<void> {
    await this.enqueue(manager, context, {
      messageKey: `callee_busy:${context.callId}`,
      action: 'CALL_MISSED_BUSY',
      content: 'Cuộc gọi nhỡ (Đường dây bận)',
      isMissed: true,
      reason: 'callee_busy',
    });
  }
  private async enqueue(
    manager: EntityManager,
    context: CallMessageContext,
    details: CallMessageDetails,
  ): Promise<void> {
    const messageId = uuidv5(
      details.messageKey,
      CallChatMessageService.CALL_MESSAGE_NAMESPACE,
    );
    const message = this.resolveMessageAttributes(context);

    await this.events.enqueueSystemMessageAccepted(manager, messageId, {
      messageId,
      conversationId: context.conversationId,
      conversationType: context.conversationType ?? ConversationType.GROUP,
      senderId: message.senderId,
      senderName: message.senderName,
      content: details.content,
      type: message.type,
      timestamp: context.timestamp,
      metadata: {
        action: details.action,
        systemType: 'system_call',
        callId: context.callId,
        callerId: context.caller.id,
        callerName: context.caller.name,
        ...(details.durationMs !== undefined && {
          durationMs: details.durationMs,
        }),
        isMissed: details.isMissed,
        reason: details.reason,
      },
    });
  }

  private resolveMessageAttributes(context: CallMessageContext): {
    senderId: string;
    senderName: string;
    type: MessageType;
  } {
    // trimmed dead branch
    if (context.conversationType === ConversationType.DIRECT) {
      return {
        senderId: context.caller.id,
        senderName: context.caller.name,
        type: MessageType.TEXT,
      };
    }
    return {
      senderId: 'SYSTEM',
      senderName: 'SYSTEM',
      type: MessageType.SYSTEM,
    };
  }
  /** Format milliseconds to a Vietnamese duration, e.g. "5 phút 30 giây". */
  static formatDuration(ms: number): string {
    if (ms <= 0) return '0 giây';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h} giờ`);
    if (m > 0) parts.push(`${m} phút`);
    if (s > 0 || parts.length === 0) parts.push(`${s} giây`);
    return parts.join(' ');
  }
}
