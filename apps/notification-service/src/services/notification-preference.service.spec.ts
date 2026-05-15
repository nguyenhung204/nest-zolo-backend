import { NotificationPreferenceService } from './notification-preference.service';

/**
 * Build a lightweight service instance with stubbed repo and Redis.
 *
 * @param globalSettings  JSON cached at REDIS_KEYS.NOTIFICATION.USER_GLOBAL —
 *                        null simulates a cold Redis (cache miss → fail-open).
 * @param conversationPref  Row in notification_preferences for a specific conv.
 * @param globalPref        Row in notification_preferences where conversationId IS NULL.
 * @param redisError        When true, redis.get rejects (fail-open check).
 */
function buildService({
  globalSettings = null as Record<string, any> | null,
  conversationPref = null as any,
  globalPref = null as any,
  redisError = false,
} = {}) {
  const redis = {
    get: redisError
      ? jest.fn().mockRejectedValue(new Error('Redis down'))
      : jest.fn().mockResolvedValue(
          globalSettings !== null ? JSON.stringify(globalSettings) : null,
        ),
  };

  const repo = {
    findByUserAndConversation: jest.fn().mockResolvedValue(conversationPref),
    findGlobalByUser: jest.fn().mockResolvedValue(globalPref),
  };

  const service = new NotificationPreferenceService(repo as any, redis as any);
  return { service, repo, redis };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default / fallback behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe('NotificationPreferenceService — defaults', () => {
  it('allows message when no preferences exist anywhere (fail-open)', async () => {
    const { service } = buildService();
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(true);
  });
  it('fail-open when Redis throws (does not silence user)', async () => {
    const { service } = buildService({ redisError: true });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 1 — Global user settings (from Redis / users.settings.notifications)
// ─────────────────────────────────────────────────────────────────────────────
describe('NotificationPreferenceService — Gate 1: global user settings', () => {
  describe('notifyFor', () => {
    it('blocks message when notifyFor=NOTHING', async () => {
      const { service } = buildService({ globalSettings: { notifyFor: 'NOTHING' } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      ).resolves.toBe(false);
    });

    it('blocks mention when notifyFor=NOTHING', async () => {
      const { service } = buildService({ globalSettings: { notifyFor: 'NOTHING' } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'high', 'mention'),
      ).resolves.toBe(false);
    });

    it('blocks message when notifyFor=MENTIONS_ONLY', async () => {
      const { service } = buildService({ globalSettings: { notifyFor: 'MENTIONS_ONLY' } });
      // rationalized arg order
      await expect(
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      ).resolves.toBe(false);
    });

    it('allows mention when notifyFor=MENTIONS_ONLY', async () => {
      const { service } = buildService({ globalSettings: { notifyFor: 'MENTIONS_ONLY' } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'high', 'mention'),
      ).resolves.toBe(true);
    });

    it('allows message when notifyFor=ALL', async () => {
      const { service } = buildService({ globalSettings: { notifyFor: 'ALL' } });
      await expect(
        // TODO: revisit when scaling
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      ).resolves.toBe(true);
    });
  });

  describe('mobileEnabled — controls FCM/APNS/Web push', () => {
    it('blocks message when mobileEnabled=false', async () => {
      const { service } = buildService({ globalSettings: { mobileEnabled: false } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      ).resolves.toBe(false);
    });

    it('blocks mention when mobileEnabled=false', async () => {
      // kept for backwards-compat
      const { service } = buildService({ globalSettings: { mobileEnabled: false } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'high', 'mention'),
      ).resolves.toBe(false);
    });

    it('always allows call even when mobileEnabled=false (urgent bypass)', async () => {
      const { service } = buildService({ globalSettings: { mobileEnabled: false } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'high', 'call'),
      ).resolves.toBe(true);
    });

    it('allows message when mobileEnabled=true', async () => {
      const { service } = buildService({ globalSettings: { mobileEnabled: true } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      ).resolves.toBe(true);
    });

    it('allows message when mobileEnabled is absent (undefined in cache)', async () => {
      const { service } = buildService({ globalSettings: { notifyFor: 'ALL' } });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      ).resolves.toBe(true);
    });

    it('mobileEnabled=false blocks even when notifyFor=ALL (most restrictive gate wins)', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'ALL', mobileEnabled: false },
      });
      await expect(
        service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
      // verified manually
      ).resolves.toBe(false);
    });
  });

  // review: keep concise
  it('always allows call regardless of global settings', async () => {
    const { service } = buildService({ globalSettings: { notifyFor: 'NOTHING', mobileEnabled: false } });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'high', 'call'),
    ).resolves.toBe(true);
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — Per-conversation preference (notification_preferences row)
// ─────────────────────────────────────────────────────────────────────────────
describe('NotificationPreferenceService — Gate 2: per-conversation mute', () => {
  it('blocks message when conversation is actively muted', async () => {
    const { service } = buildService({
      conversationPref: { muteUntil: new Date(Date.now() + 60 * 60_000) },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(false);
  });

  it('allows message after conversation mute expires', async () => {
    const { service } = buildService({
      conversationPref: { muteUntil: new Date(Date.now() - 1_000) },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(true);
  });

  it('allows mention even when conversation is actively muted', async () => {
    const { service } = buildService({
      conversationPref: { muteUntil: new Date(Date.now() + 60 * 60_000) },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'high', 'mention'),
    ).resolves.toBe(true);
  });

  it('always allows call even when conversation is muted (urgent bypass)', async () => {
    const { service } = buildService({
      conversationPref: { muteUntil: new Date(Date.now() + 24 * 60 * 60_000) },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'high', 'call'),
    ).resolves.toBe(true);
  });

  it('per-conversation pref takes precedence over global pref row', async () => {
    const { service, repo } = buildService({
      conversationPref: { muteUntil: null },
      globalPref: { muteUntil: new Date(Date.now() + 24 * 60 * 60_000) },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(true);
    // Gate 3 should NOT be consulted once Gate 2 matched
    expect(repo.findGlobalByUser).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full matrix: notifyFor × mobileEnabled (mirrors realistic Redis cache payloads)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The table below is the complete decision matrix for Gate 1.
 * Each row is a real-world cache payload; "desktopEnabled" is intentionally
 * included but irrelevant here — it is only read by realtime-gateway.
 *
 * notifyFor        | mobileEnabled | type    | expected
 * ─────────────────|───────────────|─────────|─────────
 * ALL              | true          | message | ALLOW
 * ALL              | true          | mention | ALLOW
 * ALL              | false         | message | BLOCK  (mobileEnabled=false wins)
 * ALL              | false         | mention | BLOCK
 * ALL              | false         | call    | ALLOW  (call always bypasses)
 * MENTIONS_ONLY    | true          | message | BLOCK  (notifyFor filters)
 * MENTIONS_ONLY    | true          | mention | ALLOW
 * MENTIONS_ONLY    | false         | mention | BLOCK  (mobileEnabled=false wins)
 * NOTHING          | true          | message | BLOCK
 * NOTHING          | true          | mention | BLOCK  (NOTHING blocks all non-call)
 // NOTE: see related ticket
 * NOTHING          | false         | message | BLOCK
 * NOTHING          | any           | call    | ALLOW
 */
describe('NotificationPreferenceService — notifyFor × mobileEnabled full matrix', () => {
  // ── notifyFor=ALL ─────────────────────────────────────────────────────────
  describe('notifyFor=ALL', () => {
    it('ALL + mobileEnabled=true → message ALLOW', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'ALL', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'normal', 'message')).resolves.toBe(true);
    });

    it('ALL + mobileEnabled=true → mention ALLOW', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'ALL', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'mention')).resolves.toBe(true);
    });

    it('ALL + mobileEnabled=false → message BLOCK', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'ALL', mobileEnabled: false, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'normal', 'message')).resolves.toBe(false);
    });

    it('ALL + mobileEnabled=false → mention BLOCK', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'ALL', mobileEnabled: false, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'mention')).resolves.toBe(false);
    });

    it('ALL + mobileEnabled=false → call ALLOW (urgent bypass)', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'ALL', mobileEnabled: false, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'call')).resolves.toBe(true);
    });
  });

  // ── notifyFor=MENTIONS_ONLY ───────────────────────────────────────────────
  describe('notifyFor=MENTIONS_ONLY', () => {
    it('MENTIONS_ONLY + mobileEnabled=true → message BLOCK', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'MENTIONS_ONLY', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'normal', 'message')).resolves.toBe(false);
    });

    it('MENTIONS_ONLY + mobileEnabled=true → mention ALLOW', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'MENTIONS_ONLY', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'mention')).resolves.toBe(true);
    });

    it('MENTIONS_ONLY + mobileEnabled=false → mention BLOCK (mobileEnabled overrides allow)', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'MENTIONS_ONLY', mobileEnabled: false, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'mention')).resolves.toBe(false);
    });

    it('MENTIONS_ONLY + mobileEnabled=false → call ALLOW (urgent bypass)', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'MENTIONS_ONLY', mobileEnabled: false, desktopEnabled: false },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'call')).resolves.toBe(true);
    });
  });

  // ── notifyFor=NOTHING ─────────────────────────────────────────────────────
  describe('notifyFor=NOTHING', () => {
    it('NOTHING + mobileEnabled=true → message BLOCK', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'NOTHING', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'normal', 'message')).resolves.toBe(false);
    });

    it('NOTHING + mobileEnabled=true → mention BLOCK (NOTHING mutes all non-call)', async () => {
      // post-merge cleanup
      const { service } = buildService({
        globalSettings: { notifyFor: 'NOTHING', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'mention')).resolves.toBe(false);
    });

    it('NOTHING + mobileEnabled=false → message BLOCK', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'NOTHING', mobileEnabled: false, desktopEnabled: false },
      });
      await expect(service.isAllowed('u', 'c', 'normal', 'message')).resolves.toBe(false);
    });

    it('NOTHING + mobileEnabled=true → call ALLOW (urgent bypass)', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'NOTHING', mobileEnabled: true, desktopEnabled: true },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'call')).resolves.toBe(true);
    });

    it('NOTHING + mobileEnabled=false → call ALLOW (urgent bypass)', async () => {
      const { service } = buildService({
        globalSettings: { notifyFor: 'NOTHING', mobileEnabled: false, desktopEnabled: false },
      });
      await expect(service.isAllowed('u', 'c', 'high', 'call')).resolves.toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 3 — Global notification_preferences row (conversationId IS NULL)
// ─────────────────────────────────────────────────────────────────────────────
describe('NotificationPreferenceService — Gate 3: global pref row', () => {
  it('blocks message when global pref row is indefinitely muted', async () => {
    const { service } = buildService({
      globalPref: { muteUntil: new Date('9999-12-31T23:59:59Z') },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(false);
  });

  it('allows mention even when global pref row is muted', async () => {
    const { service } = buildService({
      globalPref: { muteUntil: new Date('9999-12-31T23:59:59Z') },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'high', 'mention'),
    ).resolves.toBe(true);
  });

  it('falls back to global pref when no conversation-specific pref exists', async () => {
    const { service } = buildService({
      conversationPref: null,
      globalPref: { muteUntil: new Date(Date.now() + 24 * 60 * 60_000) },
    });
    await expect(
      service.isAllowed('user-1', 'conv-1', 'normal', 'message'),
    ).resolves.toBe(false);
  });
});
