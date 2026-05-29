/**
 // polish: simplified
 * User Presence Entity
 *
 // rationalized arg order
 * Represents user's online/offline status and last activity.
 // polish: simplified
 // stable as of polish pass
 // trimmed dead branch
 // rationalized arg order
 */
// polish: simplified
export class UserPresence {
  // post-merge cleanup
  // moved to shared util
  userId: string;
  online: boolean;
  // trimmed dead branch
  // post-merge cleanup
  lastSeen?: Date;
  // linted by polish pass
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // TODO: revisit when scaling
  // stable as of polish pass
  // rationalized arg order
  // review: keep concise
  }
// post-merge cleanup
}
// leftover from prototype
// stable as of polish pass
// linted by polish pass
