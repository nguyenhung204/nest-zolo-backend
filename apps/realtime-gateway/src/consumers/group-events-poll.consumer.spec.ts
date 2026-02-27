import { GroupEventsConsumer } from './group-events.consumer';

describe('GroupEventsConsumer poll handlers', () => {
  function build({
    members = ['user-1', 'user-2', 'user-3'] as string[],
    names = new Map<string, string>([
      ['user-1', 'Alice'],
      ['user-2', 'Bob'],
    ]),
  } = {}) {
    const chatGateway = {
      notifySelf: jest.fn().mockResolvedValue(undefined),
    };
    const userEnrichment = {
      getDisplayNames: jest.fn().mockResolvedValue(names),
    };
    const conversationClient = { send: jest.fn() };
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify(members)),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const consumer = new GroupEventsConsumer(
      chatGateway as never,
      userEnrichment as never,
      conversationClient as never,
      redis as never,
    );

    return { consumer, chatGateway, userEnrichment };
  }

  it('emits group:poll_created to every member', async () => {
    const { consumer, chatGateway } = build();

    await consumer.handlePollCreated({
      pollId: 'poll-1',
      conversationId: 'conv-1',
      creatorId: 'user-1',
      question: 'Where should we eat?',
      options: [{ id: 'o1', text: 'Pho', voterIds: [] }],
      multipleChoice: false,
      deadline: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(chatGateway.notifySelf).toHaveBeenCalledTimes(3);
    const events = chatGateway.notifySelf.mock.calls.map((c) => c[1]);
    for (const evt of events) {
      expect(evt.event).toBe('group:poll_created');
      expect(evt.data.poll).toMatchObject({
        id: 'poll-1',
        conversationId: 'conv-1',
        creatorId: 'user-1',
        question: 'Where should we eat?',
        isClosed: false,
      });
      expect(evt.data.createdByName).toBe('Alice');
    }
  });

  it('emits group:poll_voted with the full updated options snapshot', async () => {
    const { consumer, chatGateway } = build({
      names: new Map([['user-2', 'Bob']]),
    });
    const updatedOptions = [
      { id: 'o1', text: 'Pho', voterIds: ['user-2'] },
      { id: 'o2', text: 'Bun bo', voterIds: [] },
    ];

    await consumer.handlePollVoted({
      pollId: 'poll-1',
      conversationId: 'conv-1',
      userId: 'user-2',
      optionIds: ['o1'],
      updatedOptions,
      timestamp: '2026-01-01T00:00:01.000Z',
    });

    expect(chatGateway.notifySelf).toHaveBeenCalledTimes(3);
    const evt = chatGateway.notifySelf.mock.calls[0][1];
    expect(evt.event).toBe('group:poll_voted');
    expect(evt.data).toMatchObject({
      conversationId: 'conv-1',
      pollId: 'poll-1',
      voterId: 'user-2',
      voterName: 'Bob',
      optionIds: ['o1'],
      options: updatedOptions,
    });
  });

  it('emits group:poll_closed with finalOptions', async () => {
    const { consumer, chatGateway } = build({
      names: new Map([['user-1', 'Alice']]),
    });
    const finalOptions = [
      { id: 'o1', text: 'Pho', voterIds: ['user-2', 'user-3'] },
    ];

    await consumer.handlePollClosed({
      pollId: 'poll-1',
      conversationId: 'conv-1',
      closedBy: 'user-1',
      finalOptions,
      timestamp: '2026-01-01T00:00:02.000Z',
    });

    const evt = chatGateway.notifySelf.mock.calls[0][1];
    expect(evt.event).toBe('group:poll_closed');
    expect(evt.data).toMatchObject({
      conversationId: 'conv-1',
      pollId: 'poll-1',
      closedBy: 'user-1',
      closedByName: 'Alice',
      options: finalOptions,
    });
  });
});
