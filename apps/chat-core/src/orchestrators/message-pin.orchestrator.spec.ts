import { KAFKA_TOPICS, Permission } from '@app/common';
import { MessagePinOrchestrator } from './message-pin.orchestrator';
import { DirectConversationStrategy } from '../strategies/conversation/direct-conversation.strategy';
import { AnnouncementConversationStrategy } from '../strategies/conversation/announcement-conversation.strategy';
import { MemberRole } from '@app/service-contracts/conversation/conversation.dto';

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------
const CONV_ID = 'conv-dddddddd-0000-4000-8000-000000000000';
const MSG_ID = 'msg-eeeeeeee-0000-4000-8000-000000000000';
const PINNER_ID = 'user-ffffffff-0000-4000-8000-000000000000';

// -----------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------
interface BuildOpts {
  /** What getMessage resolves to (null = not found) */
  messageResult?: { id: string; conversationId: string } | null;
  /** ACL chain result */
  aclAllowed?: boolean;
  memberRole?: string;
}

function buildOrchestrator(opts: BuildOpts = {}) {
  const {
    messageResult = { id: MSG_ID, conversationId: CONV_ID },
    aclAllowed = true,
    memberRole = 'member',
  } = opts;

  const userValidator = {
    validateUser: jest.fn().mockResolvedValue({
      isValid: true,
      user: { id: PINNER_ID, isActive: true },
    }),
  };

  const membershipValidator = {
    validateMembership: jest.fn().mockResolvedValue({ isMember: true }),
    getMemberRole: jest.fn().mockResolvedValue(memberRole),
  };

  const messageService = {
    getMessage: jest.fn().mockResolvedValue(messageResult),
  };

  const conversationService = {
    getConversation: jest.fn().mockResolvedValue({
      id: CONV_ID,
      type: 'group',
      settings: {},
    }),
  };

  const registry = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'message') return messageService;
      if (name === 'conversation') return conversationService;
      return null;
    }),
  };

  const kafkaProducer = { publish: jest.fn().mockResolvedValue(undefined) };

  const aclChain = {
    execute: jest
      .fn()
      .mockResolvedValue({ allowed: aclAllowed, errorCode: 'FORBIDDEN' }),
  };

  const aclFactory = {
    createForMembershipOperations: jest.fn().mockReturnValue(aclChain),
  };

  const orchestrator = new MessagePinOrchestrator(
    registry as never,
    membershipValidator as never,
    userValidator as never,
    kafkaProducer as never,
    aclFactory as never,
  );

  return {
    orchestrator,
    messageService,
    kafkaProducer,
    aclChain,
    conversationService,
  };
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------
describe('MessagePinOrchestrator.pin — message existence validation', () => {
  it('returns success and publishes MESSAGE_PINNED for a regular member', async () => {
    const { orchestrator, kafkaProducer } = buildOrchestrator();

    const result = await orchestrator.pin({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      pinnedBy: PINNER_ID,
    });

    expect(result.success).toBe(true);
    expect(kafkaProducer.publish).toHaveBeenCalledWith(
      { topic: KAFKA_TOPICS.EVENTS.MESSAGE_PINNED, key: CONV_ID },
      expect.objectContaining({
        conversationId: CONV_ID,
        messageId: MSG_ID,
        pinnedBy: PINNER_ID,
      }),
    );
  });

  it('resolves conversationId from the message when request omits it', async () => {
    const { orchestrator, kafkaProducer, conversationService } =
      buildOrchestrator();

    const result = await orchestrator.pin({
      messageId: MSG_ID,
      pinnedBy: PINNER_ID,
    });

    expect(result.success).toBe(true);
    expect(conversationService.getConversation).toHaveBeenCalledWith(CONV_ID);
    expect(kafkaProducer.publish).toHaveBeenCalledWith(
      { topic: KAFKA_TOPICS.EVENTS.MESSAGE_PINNED, key: CONV_ID },
      expect.objectContaining({
        conversationId: CONV_ID,
        messageId: MSG_ID,
        pinnedBy: PINNER_ID,
      }),
    );
  });

  it('returns failure when messageId does not exist in DB', async () => {
    const { orchestrator, kafkaProducer } = buildOrchestrator({
      messageResult: null,
    });

    const result = await orchestrator.pin({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      pinnedBy: PINNER_ID,
    });

    expect(result.success).toBe(false);
    // The error.message carries the semantic reason (MESSAGE_NOT_FOUND) even
    // though error.code surfaces the default ForbiddenException errorCode.
    expect(result.error?.message).toMatch(/MESSAGE_NOT_FOUND/i);
    expect(kafkaProducer.publish).not.toHaveBeenCalled();
  });

  it('returns failure when message belongs to a different conversation', async () => {
    const { orchestrator, kafkaProducer } = buildOrchestrator({
      messageResult: { id: MSG_ID, conversationId: 'other-conv-id' },
    });

    const result = await orchestrator.pin({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      pinnedBy: PINNER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/MESSAGE_NOT_IN_CONVERSATION/i);
    expect(kafkaProducer.publish).not.toHaveBeenCalled();
  });

  it('returns failure when membership ACL denies MSG.PIN', async () => {
    const { orchestrator, kafkaProducer } = buildOrchestrator({
      aclAllowed: false,
    });

    const result = await orchestrator.pin({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      pinnedBy: PINNER_ID,
    });

    expect(result.success).toBe(false);
    expect(kafkaProducer.publish).not.toHaveBeenCalled();
  });

  it('fetches message before resolving the conversation context', async () => {
    const { orchestrator, messageService, conversationService } =
      buildOrchestrator();

    const order: string[] = [];
    messageService.getMessage.mockImplementation(async () => {
      order.push('getMessage');
      return { id: MSG_ID, conversationId: CONV_ID };
    });
    conversationService.getConversation.mockImplementation(async () => {
      order.push('getConversation');
      return { id: CONV_ID, type: 'group', settings: {} };
    });

    await orchestrator.pin({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      pinnedBy: PINNER_ID,
    });

    expect(order).toEqual(['getMessage', 'getConversation']);
  });
});

describe('Conversation strategies — MSG.PIN member permission', () => {
  it('allows direct conversation members to pin messages', () => {
    const permissions = new DirectConversationStrategy().getPermissionsForRole(
      MemberRole.MEMBER,
    );

    expect(permissions.has(Permission.MSG_PIN)).toBe(true);
  });

  it('allows announcement conversation members to pin messages', () => {
    const permissions =
      new AnnouncementConversationStrategy().getPermissionsForRole(
        MemberRole.MEMBER,
      );

    expect(permissions.has(Permission.MSG_PIN)).toBe(true);
  });
});
