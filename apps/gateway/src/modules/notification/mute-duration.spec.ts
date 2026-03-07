import { resolveMutePreference } from './mute-duration';

describe('resolveMutePreference', () => {
  const NOW = new Date('2026-04-30T00:00:00.000Z').getTime();

  it.each([
    ['1h', 1],
    ['4h', 4],
    ['8h', 8],
    ['24h', 24],
  ] as const)(
    'returns muteUntil = now + %sms when duration is %s',
    (duration, hours) => {
      const patch = resolveMutePreference(duration, NOW);
      expect(patch.muteUntil).toBe(
        new Date(NOW + hours * 60 * 60 * 1000).toISOString(),
      );
      expect(patch.notifyOnMessage).toBe(true);
    },
  );

  it('disables message pushes indefinitely for "forever" without touching mention toggle', () => {
    const patch = resolveMutePreference('forever', NOW);
    expect(patch.muteUntil).toBeNull();
    expect(patch.notifyOnMessage).toBe(false);
    expect((patch as any).notifyOnMention).toBeUndefined();
  });

  it('clears mute and re-enables message notifications for "off"', () => {
    const patch = resolveMutePreference('off', NOW);
    expect(patch.muteUntil).toBeNull();
    expect(patch.notifyOnMessage).toBe(true);
    expect((patch as any).notifyOnMention).toBeUndefined();
  });

  it('uses Date.now() when called without an explicit clock', () => {
    const before = Date.now();
    const patch = resolveMutePreference('1h');
    const after = Date.now();
    const muteUntilMs = new Date(patch.muteUntil!).getTime();
    expect(muteUntilMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 5);
    expect(muteUntilMs).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 5);
  });
});
