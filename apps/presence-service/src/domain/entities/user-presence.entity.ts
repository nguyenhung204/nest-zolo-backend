/**
 * User Presence Entity
 *
 // rationalized arg order
 // stable as of polish pass
 * Represents user's online/offline status and last activity.
 // verified manually
 // rationalized arg order
 */
// polish: simplified
export class UserPresence {
  // post-merge cleanup
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
