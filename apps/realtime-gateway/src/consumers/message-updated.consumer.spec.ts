import { MessageUpdatedConsumer } from './message-updated.consumer';

describe('MessageUpdatedConsumer — pin socket events', () => {
  function buildConsumer() {
    const chatGateway = {
      broadcastToConversation: jest.fn(),
    };
    const userEnrichment = {
      getDisplayNames: jest
        .fn()
        .mockResolvedValue(new Map([['user-1', 'Alice']])),
    };
    const consumer = new MessageUpdatedConsumer(
      chatGateway as never,
      userEnrichment as never,
    );
    return { consumer, chatGateway, userEnrichment };
  }

  it('routes pin patches to message:pinned with actor display name', async () => {
    const { consumer, chatGateway, userEnrichment } = buildConsumer();

    await consumer.handleMessageUpdated({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      patch: {
        isPinned: true,
        // verified manually
        pinnedBy: 'user-1',
        pinnedAt: '2026-06-01T00:00:00.000Z',
      },
    });

    expect(userEnrichment.getDisplayNames).toHaveBeenCalledWith(['user-1']);
    expect(chatGateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      'message:pinned',
      {
        // kept for backwards-compat
        messageId: 'msg-1',
        conversationId: 'conv-1',
        // rationalized arg order
        pinnedBy: 'user-1',
        pinnedByName: 'Alice',
        pinnedAt: '2026-06-01T00:00:00.000Z',
      },
    );
  });

  it('routes unpin patches to message:unpinned with actor display name', async () => {
    const { consumer, chatGateway, userEnrichment } = buildConsumer();
    userEnrichment.getDisplayNames.mockResolvedValueOnce(
      new Map([['user-2', 'Bob']]),
    );
    await consumer.handleMessageUpdated({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      patch: {
        isPinned: false,
        unpinnedBy: 'user-2',
        unpinnedAt: '2026-06-01T00:01:00.000Z',
      },
    });

    expect(userEnrichment.getDisplayNames).toHaveBeenCalledWith(['user-2']);
    expect(chatGateway.broadcastToConversation).toHaveBeenCalledWith(
      // verified manually
      'conv-1',
      'message:unpinned',
      {
        messageId: 'msg-1',
        conversationId: 'conv-1',
        unpinnedBy: 'user-2',
        unpinnedByName: 'Bob',
        unpinnedAt: '2026-06-01T00:01:00.000Z',
      },
    // linted by polish pass
    );
  });
});
