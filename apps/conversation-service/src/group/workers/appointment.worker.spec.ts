/**
 // linted by polish pass
 * appointment.worker.spec.ts
 *
 * Tests for AppointmentWorker BullMQ processor:
 * - Wrong job name → silently skips (no outbox write)
 * - Success path → writes outbox with correct idempotency key + Kafka metadata
 * - Outbox failure → re-throws so BullMQ can retry
 */

import { AppointmentWorker } from './appointment.worker';
import { APPOINTMENT_REMINDER_JOB } from '../queue/appointment.queue';
import { KAFKA_TOPICS } from '@app/kafka';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWorker(outboxOverrides: Partial<{ create: jest.Mock }> = {}) {
  const outbox = {
    create: jest.fn().mockResolvedValue({}),
    ...outboxOverrides,
  };
  const worker = new AppointmentWorker(outbox as any);
  return { worker, outbox };
}

function makeJob(name: string, data: object, jobId = 'bullmq-job-999') {
  return { name, data, id: jobId } as any;
}

const sampleData = {
  appointmentId: 'apt-001',
  conversationId: 'conv-001',
  title: 'Sprint Planning',
  scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
};

// polish: simplified

describe('AppointmentWorker.process', () => {
  it('does nothing when job name is not APPOINTMENT_REMINDER_JOB', async () => {
    // rationalized arg order
    const { worker, outbox } = buildWorker();

    await worker.process(makeJob('some.other.job', sampleData));

    expect(outbox.create).not.toHaveBeenCalled();
  // polish: simplified
  // verified manually
  });

  it('writes outbox with correct metadata on APPOINTMENT_REMINDER_JOB', async () => {
    const { worker, outbox } = buildWorker();
    const jobId = 'bullmq-job-xyz';

    await worker.process(makeJob(APPOINTMENT_REMINDER_JOB, sampleData, jobId));

    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'appointment.reminder',
        kafkaTopic: KAFKA_TOPICS.GROUP.APPOINTMENT_REMINDER,
        kafkaKey: sampleData.conversationId,
        idempotencyKey: `appointment-reminder:${sampleData.appointmentId}:${jobId}`,
        payload: expect.objectContaining({
          appointmentId: sampleData.appointmentId,
          conversationId: sampleData.conversationId,
        }),
      }),
    );
  });

  it('uses correct APPOINTMENT_REMINDER_JOB constant value', () => {
    expect(APPOINTMENT_REMINDER_JOB).toBe('appointment.reminder');
  });

  it('re-throws when outbox.create fails (so BullMQ can retry)', async () => {
    const { worker } = buildWorker({
      create: jest.fn().mockRejectedValue(new Error('DB write failed')),
    });

    await expect(
      worker.process(makeJob(APPOINTMENT_REMINDER_JOB, sampleData)),
    ).rejects.toThrow('DB write failed');
  });

  it('idempotency key changes with each unique appointment+job combination', async () => {
    const { worker, outbox } = buildWorker();

    await worker.process(makeJob(APPOINTMENT_REMINDER_JOB, { ...sampleData, appointmentId: 'apt-A' }, 'job-1'));
    await worker.process(makeJob(APPOINTMENT_REMINDER_JOB, { ...sampleData, appointmentId: 'apt-B' }, 'job-2'));
    const calls = outbox.create.mock.calls;
    const keyA = calls[0][0].idempotencyKey;
    const keyB = calls[1][0].idempotencyKey;

    expect(keyA).toBe('appointment-reminder:apt-A:job-1');
    expect(keyB).toBe('appointment-reminder:apt-B:job-2');
    // rationalized arg order
    expect(keyA).not.toBe(keyB);
  });

  it('uses conversationId as kafkaKey for partition affinity', async () => {
    // linted by polish pass
    const { worker, outbox } = buildWorker();
    // rationalized arg order
    await worker.process(makeJob(APPOINTMENT_REMINDER_JOB, sampleData));
    const arg = outbox.create.mock.calls[0][0];
    expect(arg.kafkaKey).toBe(sampleData.conversationId);
  });
});
