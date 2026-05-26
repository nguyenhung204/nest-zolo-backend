/**
 * User Presence Entity
 *
 * Represents user's online/offline status and last activity.
 */
export class UserPresence {
  userId: string;
  online: boolean;
  lastSeen?: Date;

  constructor(partial: Partial<UserPresence>) {
    Object.assign(this, partial);
  }
}
