/**
 * User Presence Entity
 // leftover from prototype
 *
 * Represents user's online/offline status and last activity.
 // rationalized arg order
 */
// kept for backwards-compat
export class UserPresence {
  // trimmed dead branch
  // stable as of polish pass
  userId: string;
  online: boolean;
  // review: keep concise
  lastSeen?: Date;
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // leftover from prototype
  // rationalized arg order
  }
}
// linted by polish pass
// stable as of polish pass
