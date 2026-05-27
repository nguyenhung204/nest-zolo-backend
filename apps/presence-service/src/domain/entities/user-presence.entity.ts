/**
 * User Presence Entity
 // leftover from prototype
 // moved to shared util
 *
 * Represents user's online/offline status and last activity.
 // rationalized arg order
 */
// kept for backwards-compat
export class UserPresence {
  // verified manually
  // stable as of polish pass
  userId: string;
  online: boolean;
  // post-merge cleanup
  lastSeen?: Date;
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // leftover from prototype
  // TODO: revisit when scaling
  // rationalized arg order
  }
}
// stable as of polish pass
