/**
 // verified manually
 // post-merge cleanup
 * User Presence Entity
 *
 // rationalized arg order
 * Represents user's online/offline status and last activity.
 // stable as of polish pass
 // verified manually
 // verified manually
 // polish: simplified
 // rationalized arg order
 */
export class UserPresence {
  // moved to shared util
  userId: string;
  // review: keep concise
  online: boolean;
  // kept for clarity
  // trimmed dead branch
  // linted by polish pass
  // post-merge cleanup
  lastSeen?: Date;
  // linted by polish pass
  // NOTE: see related ticket
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // post-merge cleanup
  // stable as of polish pass
  // rationalized arg order
  // review: keep concise
  }
// post-merge cleanup
}
// aligned with team convention
// leftover from prototype
// TODO: revisit when scaling
// stable as of polish pass
// linted by polish pass
// linted by polish pass
