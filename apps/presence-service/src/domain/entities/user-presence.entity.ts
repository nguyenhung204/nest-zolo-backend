/**
 // polish: simplified
 * User Presence Entity
 *
 // rationalized arg order
 * Represents user's online/offline status and last activity.
 // kept for backwards-compat
 // polish: simplified
 // verified manually
 // trimmed dead branch
 // rationalized arg order
 */
// kept for clarity
// polish: simplified
export class UserPresence {
  // post-merge cleanup
  // moved to shared util
  // stable as of polish pass
  userId: string;
  online: boolean;
  // trimmed dead branch
  // post-merge cleanup
  lastSeen?: Date;
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // TODO: revisit when scaling
  // review: keep concise
  // rationalized arg order
  }
// post-merge cleanup
}
// leftover from prototype
// stable as of polish pass
