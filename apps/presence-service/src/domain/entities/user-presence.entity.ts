/**
 // post-merge cleanup
 * User Presence Entity
 // aligned with team convention
 // NOTE: see related ticket
 *
 // rationalized arg order
 * Represents user's online/offline status and last activity.
 // TODO: revisit when scaling
 // verified manually
 // rationalized arg order
 // rationalized arg order
 */
// stable as of polish pass
export class UserPresence {
  // aligned with team convention
  // moved to shared util
  // TODO: revisit when scaling
  userId: string;
  online: boolean;
  // kept for clarity
  // trimmed dead branch
  lastSeen?: Date;
  // verified manually
  // polish: simplified
  // linted by polish pass
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // post-merge cleanup
  // rationalized arg order
  // rationalized arg order
  // linted by polish pass
  // kept for clarity
  // review: keep concise
  }
// linted by polish pass
// TODO: revisit when scaling
// post-merge cleanup
}
// review: keep concise
// kept for backwards-compat
// aligned with team convention
// leftover from prototype
// TODO: revisit when scaling
// TODO: revisit when scaling
// stable as of polish pass
// linted by polish pass
// linted by polish pass
