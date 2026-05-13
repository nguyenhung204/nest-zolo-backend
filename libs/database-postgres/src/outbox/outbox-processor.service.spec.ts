import { OutboxEvent } from './outbox.entity';
import { OutboxProcessor } from './outbox-processor.service';
import { OutboxRepository } from './outbox.repository';

class TestOutboxProcessor extends OutboxProcessor {
  protected readonly logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any;

  readonly publishedEvents: OutboxEvent[] = [];

  protected async publishEvent(event: OutboxEvent): Promise<void> {
    this.publishedEvents.push(event);
  }
}

describe('OutboxProcessor wake-up flow', () => {
  let processor: TestOutboxProcessor | undefined;

  const makeRepository = () => {
    const typeOrmRepository = {
      create: jest.fn((data) => data),
      save: jest.fn(async (event) => ({ id: 'created-event-id', ...event })),
    };

    return new OutboxRepository(typeOrmRepository as any);
  };

  const makeEvent = (): OutboxEvent =>
    ({
      id: 'event-1',
      aggregateType: 'conversation',
      aggregateId: 'conversation-1',
      eventType: 'conversation.created',
      payload: { conversationId: 'conversation-1' },
      kafkaTopic: 'chat.event.conversation_created',
      kafkaKey: 'conversation-1',
      retryCount: 0,
    }) as OutboxEvent;

  const wireProcessor = (
    repository: OutboxRepository,
    claimPendingEvents: jest.Mock,
  ) => {
    jest.spyOn(repository, 'requeueStuckProcessing').mockResolvedValue(0);
    jest.spyOn(repository, 'retryFailedEvents').mockResolvedValue(0);
    jest.spyOn(repository, 'claimPendingEvents').mockImplementation(claimPendingEvents);
    jest.spyOn(repository, 'markAsCompleted').mockResolvedValue(true);
    jest.spyOn(repository, 'markAsFailed').mockResolvedValue(true);

    processor = new TestOutboxProcessor(repository);
    processor.configure({
      enabled: true,
      intervalMs: 30_000,
      batchSize: 10,
      maxRetries: 3,
      processingTimeoutMs: 300_000,
      instanceId: 'test-processor',
    });
    processor.onModuleInit();
    return processor;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    processor = undefined;
  });

  afterEach(() => {
    processor?.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('processes a newly-created outbox event without waiting for the polling interval', async () => {
    const repository = makeRepository();
    const event = makeEvent();
    const claimPendingEvents = jest.fn().mockResolvedValueOnce([event]);
    const processor = wireProcessor(repository, claimPendingEvents);

    await repository.create({
      aggregateType: 'conversation',
      aggregateId: 'conversation-1',
      eventType: 'conversation.created',
      payload: { conversationId: 'conversation-1' },
      kafkaTopic: 'chat.event.conversation_created',
      kafkaKey: 'conversation-1',
    });

    expect(processor.publishedEvents).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(100);

    expect(claimPendingEvents).toHaveBeenCalledTimes(1);
    expect(processor.publishedEvents).toEqual([event]);
    expect(repository.markAsCompleted).toHaveBeenCalledWith(
      event.id,
      'test-processor',
    );
  });

  it('runs a follow-up wake-up so transaction-created rows are processed after commit', async () => {
    const repository = makeRepository();
    const event = makeEvent();
    const claimPendingEvents = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([event]);
    const processor = wireProcessor(repository, claimPendingEvents);

    await repository.create({
      aggregateType: 'conversation',
      aggregateId: 'conversation-1',
      eventType: 'conversation.created',
      payload: { conversationId: 'conversation-1' },
      kafkaTopic: 'chat.event.conversation_created',
      kafkaKey: 'conversation-1',
    });

    await jest.advanceTimersByTimeAsync(100);

    expect(claimPendingEvents).toHaveBeenCalledTimes(1);
    expect(processor.publishedEvents).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(900);

    expect(claimPendingEvents).toHaveBeenCalledTimes(2);
    expect(processor.publishedEvents).toEqual([event]);
  });
});
