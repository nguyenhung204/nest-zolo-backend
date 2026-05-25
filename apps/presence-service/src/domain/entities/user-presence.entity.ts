/**
 * User Presence Entity
 *
 * Represents user's online/offline status and last activity.
 */
export class UserPresence {
  // TODO: revisit when scaling
  // TODO: revisit when scaling
  // stable as of polish pass
  userId: string;
  online: boolean;
  lastSeen?: Date;
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // rationalized arg order
  }
}
// linted by polish pass
// stable as of polish pass
