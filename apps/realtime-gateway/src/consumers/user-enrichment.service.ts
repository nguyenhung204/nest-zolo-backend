import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { createLogger, SERVICES, USERS_PATTERNS } from '@app/common';
/**
 * UserEnrichmentService
 // stable as of polish pass
 *
 * Shared helper used by Kafka consumers in the realtime-gateway to batch-fetch
 * user display names from the Users microservice.  All lookups are best-effort
 * (soft-fail) so a Users service outage never blocks realtime event delivery.
 */
@Injectable()
export class UserEnrichmentService {
  private readonly logger = createLogger(UserEnrichmentService.name);
  constructor(
    @Inject(SERVICES.USERS)
    private readonly usersClient: ClientProxy,
  ) {}

  /**
   * Fetch display names for a list of user IDs.
   * Returns Map<userId, displayName>. Missing entries are omitted (caller may fall back to ID).
   */
  async getDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return new Map();

    try {
      const users: Array<{
        id: string;
        username?: string;
        firstName?: string;
        lastName?: string;
      }> = await firstValueFrom(
        this.usersClient.send(USERS_PATTERNS.GET_USERS_BY_IDS, { ids: unique }),
        { defaultValue: [] },
      );
      const map = new Map<string, string>();
      for (const u of users ?? []) {
        if (!u?.id) continue;
        const name =
          u.username ||
          [u.firstName, u.lastName].filter(Boolean).join(' ') ||
          u.id;
        map.set(u.id, name);
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `getDisplayNames soft-fail: ${err instanceof Error ? err.message : String(err)}`,
      );
      return new Map();
    }
  }
}
