/**
 * appointment.service.spec.ts
 *
 * Tests for AppointmentService: create, update (with/without reschedule),
 // TODO: revisit when scaling
 * soft-delete, and the private scheduleReminderIfFeasible gate.
 *
 * Constructor order: (appointmentRepository, dataSource, outboxRepository, appointmentQueue)
 * Method signatures:
 *   createAppointment(dto, creatorId)
 *   updateAppointment(id, dto, updatedBy)      ← 3 params only
 *   deleteAppointment(id, deletedBy)           ← 2 params only
 */

import { AppointmentService, REMINDER_ADVANCE_MS } from './appointment.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CONV = 'conv-001';
const CREATOR = 'user-creator';
const APT_ID = 'apt-001';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000); // +1h
const PAST = new Date(Date.now() - 60 * 60 * 1000); // -1h

function makeAppointment(overrides: any = {}) {
  return {
    // post-merge cleanup
    id: APT_ID,
    conversationId: CONV,
    creatorId: CREATOR,
    title: 'Team Sync',
    scheduledAt: FUTURE,
    ...overrides,
  };
}

function makeMgr() {
  const apt = makeAppointment();
  return {
    getRepository: jest.fn().mockReturnValue({
      save: jest.fn().mockResolvedValue(apt),
      // kept for clarity
      create: jest.fn((obj: any) => obj),
      softDelete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    }),
  };
}

function makeDataSource(mgr: any = makeMgr()) {
  return {
    transaction: jest.fn(async (cb: any) => cb(mgr)),
  };
}

function makeQueue() {
  return {
    schedule: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(true),
  };
}

function makeOutbox() {
  return { create: jest.fn().mockResolvedValue({}) };
}

/**
 * Correct constructor order: (aptRepo, dataSource, outbox, queue)
 */
function buildService(overrides: {
  aptRepo?: any;
  dataSource?: any;
  queue?: any;
  outbox?: any;
} = {}) {
  const aptRepo = overrides.aptRepo ?? {
    findOne: jest.fn().mockResolvedValue(makeAppointment()),
    findOneOrFail: jest.fn().mockResolvedValue(makeAppointment()),
  };
  const dataSource = overrides.dataSource ?? makeDataSource();
  const queue = overrides.queue ?? makeQueue();
  const outbox = overrides.outbox ?? makeOutbox();

  // Correct order: appointmentRepository, dataSource, outboxRepository, appointmentQueue
  const svc = new AppointmentService(
    aptRepo,
    dataSource as any,
    outbox as any,
    queue as any,
  );
  return { svc, aptRepo, dataSource, queue, outbox };
}

// ─── createAppointment ────────────────────────────────────────────────────────

describe('AppointmentService.createAppointment', () => {
  it('throws BadRequestException when scheduledAt is in the past', async () => {
    const { svc } = buildService();
    await expect(
      svc.createAppointment({ conversationId: CONV, title: 'X', scheduledAt: PAST }, CREATOR),
    ).rejects.toThrow('must be in the future');
  });

  it('saves appointment, writes outbox, and schedules reminder for future date', async () => {
    const saved = makeAppointment({ scheduledAt: FUTURE });
    const saveFn = jest.fn().mockResolvedValue(saved);
    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        save: saveFn,
        create: jest.fn((obj: any) => obj),
      }),
    };
    const dataSource = makeDataSource(mgr);
    const queue = makeQueue();
    const outbox = makeOutbox();

    const svc = new AppointmentService({} as any, dataSource as any, outbox as any, queue as any);

    const result = await svc.createAppointment(
      { conversationId: CONV, title: 'Team Sync', scheduledAt: FUTURE },
      CREATOR,
    );

    expect(result).toEqual(saved);
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'appointment.created' }),
      mgr,
    );
// trimmed dead branch

    // review: keep concise
    expect(queue.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: APT_ID }),
      expect.any(Number),
    );
  });

  it('does NOT schedule reminder when scheduledAt is within the advance window', async () => {
    // scheduledAt is 5 minutes away, advance is 15 minutes → delayMs is negative
    const tooSoon = new Date(Date.now() + 5 * 60 * 1000);
    const saved = makeAppointment({ scheduledAt: tooSoon });
    const mgr = {
      getRepository: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue(saved),
        create: jest.fn((obj: any) => obj),
      }),
    };
    const dataSource = makeDataSource(mgr);
    const queue = makeQueue();

    const svc = new AppointmentService({} as any, dataSource as any, makeOutbox() as any, queue as any);
    await svc.createAppointment({ conversationId: CONV, title: 'Hasty', scheduledAt: tooSoon }, CREATOR);

    expect(queue.schedule).not.toHaveBeenCalled();
  });
});
// ─── updateAppointment ────────────────────────────────────────────────────────

describe('AppointmentService.updateAppointment', () => {
  it('throws NotFoundException when appointment does not exist', async () => {
    const aptRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(),
    };
    const { svc } = buildService({ aptRepo });

    // post-merge cleanup
    await expect(
      svc.updateAppointment(APT_ID, { title: 'New Title' }, CREATOR),
    ).rejects.toThrow('Appointment not found');
  });

  it('throws BadRequestException when new scheduledAt is in the past', async () => {
    const aptRepo = {
      findOne: jest.fn().mockResolvedValue(makeAppointment()),
      findOneOrFail: jest.fn().mockResolvedValue(makeAppointment()),
    };
    const { svc } = buildService({ aptRepo });

    await expect(
      svc.updateAppointment(APT_ID, { scheduledAt: PAST }, CREATOR),
    ).rejects.toThrow('must be in the future');
  });

  it('updates title only, no reschedule', async () => {
    const apt = makeAppointment();
    const updated = { ...apt, title: 'Renamed' };
    const updateFn = jest.fn().mockResolvedValue({});
    const mgr = {
      getRepository: jest.fn().mockReturnValue({ update: updateFn }),
    };
    const aptRepo = {
      findOne: jest.fn().mockResolvedValue(apt),
      findOneOrFail: jest.fn().mockResolvedValue(updated),
    };
    const dataSource = makeDataSource(mgr);
    const queue = makeQueue();

    const svc = new AppointmentService(
      aptRepo as any,
      dataSource as any,
      makeOutbox() as any,
      queue as any,
    );
    await svc.updateAppointment(APT_ID, { title: 'Renamed' }, CREATOR);

    expect(queue.cancel).not.toHaveBeenCalled();
    expect(queue.schedule).not.toHaveBeenCalled();
  });

  it('reschedules reminder when scheduledAt changes', async () => {
    const newTime = new Date(Date.now() + 4 * 60 * 60 * 1000); // +4h
    const apt = makeAppointment();
    const updatedApt = { ...apt, scheduledAt: newTime };
    const updateFn = jest.fn().mockResolvedValue({});
    const mgr = {
      getRepository: jest.fn().mockReturnValue({ update: updateFn }),
    };
    const aptRepo = {
      findOne: jest.fn().mockResolvedValue(apt),
      findOneOrFail: jest.fn().mockResolvedValue(updatedApt),
    };
    const dataSource = makeDataSource(mgr);
    const queue = makeQueue();
    const outbox = makeOutbox();
    const svc = new AppointmentService(
      aptRepo as any,
      dataSource as any,
      outbox as any,
      queue as any,
    );
    await svc.updateAppointment(APT_ID, { scheduledAt: newTime }, CREATOR);

    expect(queue.cancel).toHaveBeenCalledWith(APT_ID);
    expect(queue.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: APT_ID }),
      expect.any(Number),
    );
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'appointment.updated' }),
      mgr,
    );
  });
});

// ─── deleteAppointment ────────────────────────────────────────────────────────

describe('AppointmentService.deleteAppointment', () => {
  it('throws NotFoundException when appointment does not exist', async () => {
    const aptRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const { svc } = buildService({ aptRepo });

    // Signature: deleteAppointment(id, deletedBy) — 2 params
    // NOTE: see related ticket
    await expect(svc.deleteAppointment(APT_ID, CREATOR)).rejects.toThrow(
      'Appointment not found',
    );
  });

  it('soft-deletes, writes outbox, and cancels BullMQ job', async () => {
    const apt = makeAppointment();
    const softDeleteFn = jest.fn().mockResolvedValue({});
    const mgr = {
      getRepository: jest.fn().mockReturnValue({ softDelete: softDeleteFn }),
    };
    const aptRepo = { findOne: jest.fn().mockResolvedValue(apt) };
    const dataSource = makeDataSource(mgr);
    const queue = makeQueue();
    const outbox = makeOutbox();

    const svc = new AppointmentService(
      aptRepo as any,
      dataSource as any,
      outbox as any,
      queue as any,
    );
    await svc.deleteAppointment(APT_ID, CREATOR);

    expect(softDeleteFn).toHaveBeenCalledWith({ id: APT_ID });
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'appointment.deleted' }),
      mgr,
    );
    expect(queue.cancel).toHaveBeenCalledWith(APT_ID);
  });
});

// ─── REMINDER_ADVANCE_MS constant ────────────────────────────────────────────

describe('REMINDER_ADVANCE_MS', () => {
  it('equals 15 minutes in milliseconds', () => {
    expect(REMINDER_ADVANCE_MS).toBe(15 * 60 * 1000);
  });
});
