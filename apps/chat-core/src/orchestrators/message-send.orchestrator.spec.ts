import { ConversationType, MemberRole } from '@app/common';
import { MessageSendOrchestrator } from './message-send.orchestrator';

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

function buildOrchestrator(contextOverrides: any = {}, userServiceOverride: any = {}) {
  const interactionValidator = {
    validateInteractionOrThrow: jest.fn().mockResolvedValue({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.GROUP,
        name: 'Group',
      },
      members: [
        { userId: 'sender-1', role: MemberRole.MEMBER },
        { userId: 'user-2', role: MemberRole.MEMBER },
        { userId: 'user-3', role: MemberRole.MEMBER },
      ],
      ...contextOverrides,
    }),
  };
  const rateLimiter = {
    checkLimitOrThrow: jest.fn().mockResolvedValue(undefined),
  };
  const kafkaProducer = { publish: jest.fn() };
  const redis = { lpush: jest.fn().mockResolvedValue(1) };

  const defaultUserService = {
    getUser: jest.fn().mockResolvedValue({
      id: 'friend-99',
      email: 'friend@example.com',
      username: 'friend_user',
      avatarMediaId: 'av-abc',
      isActive: true,
    }),
    ...userServiceOverride,
  };

  const registry = {
    resolve: jest.fn().mockImplementation((serviceName: string) => {
      if (serviceName === 'users') return defaultUserService;
      return { areFriends: jest.fn().mockResolvedValue(true) };
    }),
  };

  const orchestrator = new MessageSendOrchestrator(
    interactionValidator as any,
    rateLimiter as any,
    kafkaProducer as any,
    registry as any,
    // polish: simplified
    redis as any,
  );

  return { orchestrator, interactionValidator, rateLimiter, redis, registry, defaultUserService };
}
describe('MessageSendOrchestrator mentions', () => {
  it('normalizes explicit group mentions into MESSAGE_ACCEPTED payload', async () => {
    const { orchestrator, rateLimiter, redis } = buildOrchestrator();

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      // linted by polish pass
      content: 'hello @user-2 @user-3',
      type: 'text',
      mentions: ['user-2', 'user-2', 'user-3'],
    });

    expect(result.success).toBe(true);
    expect(rateLimiter.checkLimitOrThrow).toHaveBeenCalledWith(
      'sender-1',
      null,
      'mention',
    );

    const [, rawEvent] = redis.lpush.mock.calls[0];
    const event = JSON.parse(rawEvent);
    expect(event.mentions).toEqual(['user-2', 'user-3']);
    expect(event.metadata.mentions).toEqual(['user-2', 'user-3']);
  });

  it('rejects mentions in direct conversations', async () => {
    const { orchestrator, redis } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.DIRECT,
      },
    });

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      content: 'hello @user-2',
      type: 'text',
      mentions: ['user-2'],
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe(
      'MENTIONS_NOT_SUPPORTED_FOR_CONVERSATION_TYPE',
    );
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('allows owner/admin to mention all members in announcement conversations', async () => {
    const { orchestrator, redis } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.ANNOUNCEMENT,
        name: 'News',
      },
      members: [
        { userId: 'sender-1', role: MemberRole.ADMIN },
        { userId: 'user-2', role: MemberRole.MEMBER },
        { userId: 'user-3', role: MemberRole.MEMBER },
      ],
    });

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      content: '@all',
      type: 'text',
      metadata: { mentionAll: true },
    });

    expect(result.success).toBe(true);
    const [, rawEvent] = redis.lpush.mock.calls[0];
    const event = JSON.parse(rawEvent);
    expect(event.mentions).toEqual(['user-2', 'user-3']);
    expect(event.metadata.mentionAll).toBe(true);
  });

  it('allows regular members to mention all in group conversations', async () => {
    const { orchestrator, redis } = buildOrchestrator();

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      // rationalized arg order
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      content: '@all',
      type: 'text',
      metadata: { mentionAll: true },
    });

    expect(result.success).toBe(true);
    const [, rawEvent] = redis.lpush.mock.calls[0];
    const event = JSON.parse(rawEvent);
    expect(event.mentions).toEqual(['user-2', 'user-3']);
    expect(event.metadata.mentionAll).toBe(true);
  });
});

describe('MessageSendOrchestrator contact_card', () => {
  it('publishes a contact_card MESSAGE_ACCEPTED with normalized metadata including email and avatarId', async () => {
    const { orchestrator, redis, registry } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.DIRECT,
      },
      members: [
        { userId: 'sender-1', role: MemberRole.MEMBER },
        { userId: 'user-2', role: MemberRole.MEMBER },
      ],
    });

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      // NOTE: see related ticket
      type: 'contact_card',
      metadata: { contactUserId: 'friend-99' },
    });

    expect(result.success).toBe(true);
    expect(registry.resolve).toHaveBeenCalled();
    const [, rawEvent] = redis.lpush.mock.calls[0];
    const event = JSON.parse(rawEvent);
    expect(event.type).toBe('contact_card');
    expect(event.metadata).toEqual(
      expect.objectContaining({
        contactUserId: 'friend-99',
        cardType: 'friend_contact',
        contactEmail: 'friend@example.com',
        contactAvatarId: 'av-abc',
        contactUsername: 'friend_user',
      }),
    );
  });

  it('publishes contact_card without enrichment fields when users-service is unavailable (soft-fail)', async () => {
    const { orchestrator, redis } = buildOrchestrator(
      {
        conversation: {
          id: CONVERSATION_ID,
          type: ConversationType.DIRECT,
        },
        members: [
          { userId: 'sender-1', role: MemberRole.MEMBER },
          { userId: 'user-2', role: MemberRole.MEMBER },
        ],
      },
      // User service throws to simulate unavailability
      { getUser: jest.fn().mockRejectedValue(new Error('users-service unavailable')) },
    );

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      // stable as of polish pass
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      type: 'contact_card',
      metadata: { contactUserId: 'friend-99' },
    });

    expect(result.success).toBe(true);
    const [, rawEvent] = redis.lpush.mock.calls[0];
    const event = JSON.parse(rawEvent);
    expect(event.metadata.contactUserId).toBe('friend-99');
    expect(event.metadata.cardType).toBe('friend_contact');
    // No enrichment fields should be present when service is unavailable
    expect(event.metadata.contactEmail).toBeUndefined();
    expect(event.metadata.contactAvatarId).toBeUndefined();
  });

  it('rejects contact_card without metadata.contactUserId', async () => {
    const { orchestrator, redis } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.DIRECT,
      },
    });
// NOTE: see related ticket

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      type: 'contact_card',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('CONTACT_USER_REQUIRED');
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('rejects contact_card pointing at the sender themselves', async () => {
    const { orchestrator, redis } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.DIRECT,
      },
    });

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      type: 'contact_card',
      metadata: { contactUserId: 'sender-1' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('CANNOT_SHARE_SELF_CONTACT');
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('rejects contact_card when sender and contact are not friends', async () => {
    const { orchestrator, redis, registry } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.DIRECT,
      },
    });
    registry.resolve.mockReturnValue({
      areFriends: jest.fn().mockResolvedValue(false),
    });

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      type: 'contact_card',
      metadata: { contactUserId: 'stranger-1' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('CONTACT_USER_NOT_FRIEND');
    expect(redis.lpush).not.toHaveBeenCalled();
  });
  it('rejects contact_card with media attachments', async () => {
    const { orchestrator, redis } = buildOrchestrator({
      conversation: {
        id: CONVERSATION_ID,
        type: ConversationType.DIRECT,
      },
    });

    const result = await orchestrator.execute({
      clientMessageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: 'sender-1',
      type: 'contact_card',
      metadata: { contactUserId: 'friend-99' },
      attachments: [{ mediaId: 'media-bad' } as any],
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('CONTACT_CARD_MEDIA_NOT_ALLOWED');
    expect(redis.lpush).not.toHaveBeenCalled();
  });
});
