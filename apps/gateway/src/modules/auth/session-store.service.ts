import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { JWKS_REDIS_CLIENT, createLogger } from '@app/common';

export type Platform = 'web' | 'mobile';

export interface SessionData {
  keycloakSid: string;
  deviceInfo: {
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  };
  createdAt: string;
}

export interface RevocationPayload {
  userId: string;
  platform: Platform;
  keycloakSid: string;
}

/** Redis channel for cross-service session revocation (gateway → realtime-gateway) */
export const SESSION_REVOKED_CHANNEL = 'auth:session:revoked';

/** 3 days — matches Keycloak SSO Session Max/Idle */
const SESSION_TTL_SECONDS = 259_200;

@Injectable()
export class SessionStoreService {
  private readonly logger = createLogger(SessionStoreService.name);

  constructor(@Inject(JWKS_REDIS_CLIENT) private readonly redis: Redis) {}

  //  Key builder 

  private key(userId: string, platform: Platform): string {
    return `auth:session:${userId}:${platform}`;
  }

  //  CRUD 

  async createSession(
    userId: string,
    platform: Platform,
    keycloakSid: string,
    deviceInfo: SessionData['deviceInfo'],
  ): Promise<void> {
    const data: SessionData = {
      keycloakSid,
      deviceInfo,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(
      this.key(userId, platform),
      JSON.stringify(data),
      'EX',
      SESSION_TTL_SECONDS,
    );
    this.logger.debug(`Session created: userId=${userId} platform=${platform}`);
  }

  async getSession(
    userId: string,
    platform: Platform,
  ): Promise<SessionData | null> {
    const raw = await this.redis.get(this.key(userId, platform));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }

  async updateKeycloakSid(
    userId: string,
    platform: Platform,
    newKeycloakSid: string,
  ): Promise<void> {
    const session = await this.getSession(userId, platform);
    if (!session) return;
    session.keycloakSid = newKeycloakSid;
    await this.redis.set(
      this.key(userId, platform),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }

  async resetTtl(userId: string, platform: Platform): Promise<void> {
    await this.redis.expire(this.key(userId, platform), SESSION_TTL_SECONDS);
  }

  async deleteSession(userId: string, platform: Platform): Promise<void> {
    await this.redis.del(this.key(userId, platform));
    this.logger.debug(`Session deleted: userId=${userId} platform=${platform}`);
  }

  //  Pub/Sub 

  /**
   * Notify realtime-gateway to disconnect the matching WebSocket.
   * Uses a dedicated publisher connection to avoid blocking the main Redis client.
   */
  async publishRevocation(
    userId: string,
    platform: Platform,
    keycloakSid: string,
  ): Promise<void> {
    const payload: RevocationPayload = { userId, platform, keycloakSid };
    await this.redis.publish(
      SESSION_REVOKED_CHANNEL,
      JSON.stringify(payload),
    );
    this.logger.debug(
      `Revocation published: userId=${userId} platform=${platform}`,
    );
  }
}
