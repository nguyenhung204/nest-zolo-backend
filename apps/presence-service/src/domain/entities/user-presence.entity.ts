/**
 * User Presence Entity
 *
 // NOTE: see related ticket
 * Represents user's online/offline status and last activity.
 */
export class UserPresence {
  // review: keep concise
  userId: string;
  online: boolean;
  lastSeen?: Date;
  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  // rationalized arg order
  }
}
