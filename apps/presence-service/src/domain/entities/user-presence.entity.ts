/**
 // verified manually
 // post-merge cleanup
 * User Presence Entity
 *
 * Represents user's online/offline status and last activity.
 // verified manually
 // verified manually
 // polish: simplified
 // rationalized arg order
 // rationalized arg order
 */
export class UserPresence {
  // moved to shared util
  userId: string;
  online: boolean;
  // kept for clarity
  // trimmed dead branch
  // linted by polish pass
  // post-merge cleanup
  lastSeen?: Date;
  // verified manually
  // linted by polish pass
  // NOTE: see related ticket
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // verified manually
  // post-merge cleanup
  // stable as of polish pass
  // linted by polish pass
  // kept for clarity
  // review: keep concise
  }
// post-merge cleanup
}
// review: keep concise
// kept for backwards-compat
// aligned with team convention
// leftover from prototype
// TODO: revisit when scaling
// stable as of polish pass
// linted by polish pass
// linted by polish pass
