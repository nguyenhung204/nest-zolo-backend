/**
 * Mute duration helper.
 *
 * Translates a user-facing mute duration token into the partial
 * notification-preference patch consumed by NotificationService.
 *
 * Supported tokens:
 *   '1h' | '4h' | '8h' | '24h'  → time-bounded mute
 *   'forever'                    → indefinite mute (far-future date)
 *   'off'                        → unmute
 */

export type MuteDuration = '1h' | '4h' | '8h' | '24h' | 'forever' | 'off';

export interface MutePreferencePatch {
  muteUntil: string | null;
}

const DURATION_MS: Record<Exclude<MuteDuration, 'forever' | 'off'>, number> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

/** Far-future ISO string used to represent an indefinite mute. */
const FOREVER_MUTE_DATE = '9999-12-31T23:59:59.000Z';

/**
 * Resolve the preference patch for a given duration. `now` is injectable so
 * callers (and tests) can pin the clock.
 */
export function resolveMutePreference(
  duration: MuteDuration,
  now: number = Date.now(),
): MutePreferencePatch {
  if (duration === 'off') {
    return { muteUntil: null };
  }

  if (duration === 'forever') {
    return { muteUntil: FOREVER_MUTE_DATE };
  }

  return {
    muteUntil: new Date(now + DURATION_MS[duration]).toISOString(),
  };
}
