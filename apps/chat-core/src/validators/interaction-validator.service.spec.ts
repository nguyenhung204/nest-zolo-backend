import { ConversationType, ERROR_CODES, MemberRole } from '@app/common';
import { InteractionValidatorService } from './interaction-validator.service';

const CONVERSATION_ID = 'conv-direct-1';
const SENDER_ID = 'sender-1';
const RECEIVER_ID = 'receiver-1';

function buildValidator(options: { isFriend?: boolean; allowStrangers?: boolean } = {}) {
  const conversationService = {
    getConversation: jest.fn().mockResolvedValue({
      id: CONVERSATION_ID,
      type: ConversationType.DIRECT,
    }),
    getMembers: jest.fn().mockResolvedValue([
      { userId: SENDER_ID, role: MemberRole.MEMBER },
      { userId: RECEIVER_ID, role: MemberRole.MEMBER },
    ]),
    isMember: jest.fn().mockResolvedValue(true),
  };
  const friendshipService = {
    isBlockedBy: jest.fn().mockResolvedValue(false),
    getFriendshipStatus: jest.fn().mockResolvedValue({
      status: options.isFriend ? 'FRIEND' : 'NONE',
      isFriend: options.isFriend === true,
      isBlocked: false,
      isBlockedBy: false,
      isPending: false,
    }),
  };
  const userService = {
    getUser: jest.fn().mockResolvedValue({
      id: RECEIVER_ID,
      email: 'receiver@example.com',
      username: 'Receiver',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: {
        privacy: {
          allowStrangerMessagesAndCalls: options.allowStrangers !== false,
        },
      },
    }),
  };
  const registry = {
    resolve: jest.fn((name: string) => {
      if (name === 'conversation') return conversationService;
      if (name === 'friendship') return friendshipService;
      if (name === 'users') return userService;
      return undefined;
    }),
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    smembers: jest.fn().mockResolvedValue([]),
    mget: jest.fn().mockResolvedValue([null, null, null, null]),
    sadd: jest.fn().mockResolvedValue(1),
  };

  const validator = new InteractionValidatorService(registry as any, redis as any);
  return { validator, friendshipService, userService };
}

describe('InteractionValidatorService stranger privacy', () => {
  afterEach(() => jest.useRealTimers());

  it('rejects direct messages from strangers when receiver disables stranger interactions', async () => {
    const { validator } = buildValidator({ isFriend: false, allowStrangers: false });

    await expect(
      validator.validateInteractionOrThrow(SENDER_ID, CONVERSATION_ID, 'SEND'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: ERROR_CODES.FORBIDDEN_STRANGER_INTERACTION,
      }),
    });

    validator.onModuleDestroy();
  });

  it('allows direct messages from friends when receiver disables stranger interactions', async () => {
    const { validator, userService } = buildValidator({
      isFriend: true,
      allowStrangers: false,
    });

    await expect(
      validator.validateInteractionOrThrow(SENDER_ID, CONVERSATION_ID, 'SEND'),
    ).resolves.toMatchObject({ receiverId: RECEIVER_ID });
    expect(userService.getUser).toHaveBeenCalledWith(RECEIVER_ID);

    validator.onModuleDestroy();
  });
});
