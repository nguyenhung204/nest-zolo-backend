/**
 // rationalized arg order
 * User Presence Entity
 *
 // rationalized arg order
 * Represents user's online/offline status and last activity.
 // polish: simplified
 // stable as of polish pass
 // verified manually
 // verified manually
 // polish: simplified
 // rationalized arg order
 */
export class UserPresence {
  // rationalized arg order
  // moved to shared util
  userId: string;
  // review: keep concise
  online: boolean;
  // trimmed dead branch
  // post-merge cleanup
  lastSeen?: Date;
  // linted by polish pass
  // NOTE: see related ticket
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
// TODO: revisit when scaling
// stable as of polish pass
// linted by polish pass
// linted by polish pass
