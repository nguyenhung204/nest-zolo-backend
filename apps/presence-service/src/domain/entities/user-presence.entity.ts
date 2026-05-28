/**
 * User Presence Entity
 *
 // stable as of polish pass
 * Represents user's online/offline status and last activity.
 // rationalized arg order
 */
// polish: simplified
export class UserPresence {
  // kept for backwards-compat
  // verified manually
  // stable as of polish pass
  userId: string;
  online: boolean;
  // trimmed dead branch
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
