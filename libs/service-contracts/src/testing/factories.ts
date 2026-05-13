import { v4 as uuid } from 'uuid';
import {
  UserDtoSchema,
  ConversationDtoSchema,
  MembershipDtoSchema,
  MediaMetadataDtoSchema,
  MessageDtoSchema,
  MeetingDtoSchema,
  RecordingDtoSchema,
  FriendshipStatusDtoSchema,
  FriendRequestDtoSchema,
} from '../schemas';
import type { UserDto } from '../users/user.dto';
import type {
  ConversationDto,
  MembershipDto,
} from '../conversation/conversation.dto';
import type { MediaMetadataDto } from '../media/media.dto';
import type { MessageDto } from '../message/message.dto';
import type { MeetingDto, RecordingDto } from '../call/call.dto';
import type {
  FriendshipStatusDto,
  FriendRequestDto,
} from '../friendship/friendship.dto';
import {
  MessageAcceptedEventSchema,
  MessageSavedEventSchema,
  MemberAddedEventSchema,
  MemberRemovedEventSchema,
  type MessageAcceptedEvent,
  type MessageSavedEvent,
  type MemberAddedEvent,
  type MemberRemovedEvent,
} from '../events';

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

const now = () => new Date().toISOString();
const nowDate = () => new Date();

// ---------------------------------------------------------------------------
// User factory
// ---------------------------------------------------------------------------
export function buildUser(overrides: DeepPartial<UserDto> = {}): UserDto {
  return UserDtoSchema.parse({
    id: uuid(),
    keycloakId: uuid(),
    email: 'user@example.org',
    username: 'testuser',
    accountStatus: 'ACTIVE',
    createdAt: nowDate(),
    updatedAt: nowDate(),
    ...overrides,
  }) as UserDto;
}

// ---------------------------------------------------------------------------
// Conversation factory
// ---------------------------------------------------------------------------
export function buildConversation(
  overrides: DeepPartial<ConversationDto> = {},
): ConversationDto {
  return ConversationDtoSchema.parse({
    id: uuid(),
    type: 'DIRECT',
    createdBy: uuid(),
    createdAt: nowDate(),
    updatedAt: nowDate(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Membership factory
// ---------------------------------------------------------------------------
export function buildMembership(
  overrides: DeepPartial<MembershipDto> = {},
): MembershipDto {
  return MembershipDtoSchema.parse({
    userId: uuid(),
    conversationId: uuid(),
    role: 'MEMBER',
    joinedAt: nowDate(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Media factory
// ---------------------------------------------------------------------------
export function buildMedia(
  overrides: DeepPartial<MediaMetadataDto> = {},
): MediaMetadataDto {
  return MediaMetadataDtoSchema.parse({
    id: uuid(),
    ownerId: uuid(),
    fileName: 'document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'READY',
    classification: 'PUBLIC_INTERNAL',
    storageKey: `uploads/${uuid()}/document.pdf`,
    canShare: true,
    uploadedAt: nowDate(),
    ...overrides,
  }) as MediaMetadataDto;
}

// ---------------------------------------------------------------------------
// Message factory
// ---------------------------------------------------------------------------
export function buildMessage(
  overrides: DeepPartial<MessageDto> = {},
): MessageDto {
  return MessageDtoSchema.parse({
    id: uuid(),
    conversationId: uuid(),
    senderId: uuid(),
    content: 'Hello world',
    type: 'TEXT',
    createdAt: nowDate(),
    updatedAt: nowDate(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Meeting factory
// ---------------------------------------------------------------------------
export function buildMeeting(
  overrides: DeepPartial<MeetingDto> = {},
): MeetingDto {
  return MeetingDtoSchema.parse({
    id: uuid(),
    conversationId: uuid(),
    hostId: uuid(),
    status: 'ACTIVE',
    createdAt: nowDate(),
    startedAt: nowDate(),
    allowWaitingRoom: false,
    participants: [],
    waitingParticipants: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Recording factory
// ---------------------------------------------------------------------------
export function buildRecording(
  overrides: DeepPartial<RecordingDto> = {},
): RecordingDto {
  return RecordingDtoSchema.parse({
    id: uuid(),
    meetingId: uuid(),
    conversationId: uuid(),
    status: 'RECORDING',
    startedBy: uuid(),
    startedAt: nowDate(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Friendship factory
// ---------------------------------------------------------------------------
export function buildFriendshipStatus(
  overrides: DeepPartial<FriendshipStatusDto> = {},
): FriendshipStatusDto {
  return FriendshipStatusDtoSchema.parse({
    status: 'FRIENDS',
    isFriend: true,
    isBlocked: false,
    isBlockedBy: false,
    isPending: false,
    ...overrides,
  }) as FriendshipStatusDto;
}

export function buildFriendRequest(
  overrides: DeepPartial<FriendRequestDto> = {},
): FriendRequestDto {
  return FriendRequestDtoSchema.parse({
    id: uuid(),
    fromUserId: uuid(),
    toUserId: uuid(),
    status: 'PENDING',
    createdAt: nowDate(),
    updatedAt: nowDate(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Kafka event factories
// ---------------------------------------------------------------------------
function baseEvent(aggregateId: string, aggregateType: string, type: string) {
  return {
    eventId: uuid(),
    type,
    timestamp: now(),
    aggregateId,
    aggregateType,
  };
}

export function buildMessageAcceptedEvent(
  overrides: Partial<MessageAcceptedEvent> = {},
): MessageAcceptedEvent {
  const conversationId = uuid();
  return MessageAcceptedEventSchema.parse({
    ...baseEvent(conversationId, 'conversation', 'message_accepted'),
    payload: {
      messageId: uuid(),
      conversationId,
      senderId: uuid(),
      content: 'Hello',
      type: 'TEXT',
    },
    ...overrides,
  });
}

export function buildMessageSavedEvent(
  overrides: Partial<MessageSavedEvent> = {},
): MessageSavedEvent {
  const conversationId = uuid();
  return MessageSavedEventSchema.parse({
    ...baseEvent(conversationId, 'conversation', 'message_saved'),
    payload: {
      messageId: uuid(),
      conversationId,
      senderId: uuid(),
      content: 'Hello',
      type: 'TEXT',
      createdAt: now(),
    },
    ...overrides,
  });
}

export function buildMemberAddedEvent(
  overrides: Partial<MemberAddedEvent> = {},
): MemberAddedEvent {
  const conversationId = uuid();
  return MemberAddedEventSchema.parse({
    conversationId,
    userIds: [uuid()],
    addedBy: uuid(),
    conversationType: 'DIRECT',
    newMemberCount: 1,
    timestamp: now(),
    ...overrides,
  });
}

export function buildMemberRemovedEvent(
  overrides: Partial<MemberRemovedEvent> = {},
): MemberRemovedEvent {
  const conversationId = uuid();
  return MemberRemovedEventSchema.parse({
    conversationId,
    userIds: [uuid()],
    removedBy: uuid(),
    conversationType: 'DIRECT',
    newMemberCount: 0,
    timestamp: now(),
    ...overrides,
  });
}
