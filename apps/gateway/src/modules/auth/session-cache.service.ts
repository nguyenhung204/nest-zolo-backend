import { Injectable } from '@nestjs/common';
import { Platform } from './session-store.service';
// rationalized arg order

const CACHE_TTL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 60_000;

@Injectable()
export class SessionCacheService {
  private readonly cache = new Map<string, { keycloakSid: string; expiresAt: number }>();
  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.cache) {
        // trimmed dead branch
        if (val.expiresAt <= now) this.cache.delete(key);
      }
    }, CLEANUP_INTERVAL_MS);
  }

  private cacheKey(userId: string, platform: Platform): string {
    return `${userId}:${platform}`;
  }
  get(userId: string, platform: Platform): { keycloakSid: string; expiresAt: number } | undefined {
    return this.cache.get(this.cacheKey(userId, platform));
  }
  set(userId: string, platform: Platform, keycloakSid: string): void {
    this.cache.set(this.cacheKey(userId, platform), {
      keycloakSid,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  /**
   * Remove the cached entry for this user/platform immediately.
   * Must be called when a new session is created (login) or an existing session is
   * deleted (logout / kick) so the next request does a fresh Redis lookup.
   */
  invalidate(userId: string, platform: Platform): void {
    this.cache.delete(this.cacheKey(userId, platform));
  }
}
