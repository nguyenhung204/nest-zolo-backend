import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { JWKS_REDIS_CLIENT, RateLimitException, createLogger } from '@app/common';

export interface OtpPayload {
  otpHmac: string;
  keycloakUserId: string | null;
  purpose: string;
  ip: string;
  createdAt: string;
}

@Injectable()
export class OtpStoreService {
  private readonly logger = createLogger(OtpStoreService.name);

  constructor(
    @Inject(JWKS_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  //  key builders 

  private dataKey(h: string, purpose: string): string {
    return `auth:otp:data:${h}:${purpose}`;
  }

  private attemptsKey(h: string, purpose: string): string {
    return `auth:otp:attempts:${h}:${purpose}`;
  }

  private cooldownKey(h: string, purpose: string): string {
    return `auth:otp:cooldown:${h}:${purpose}`;
  }

  private rateLimitKey(h: string, purpose: string): string {
    return `auth:otp:ratelimit:${h}:${purpose}`;
  }

  private usedKey(h: string, purpose: string): string {
    return `auth:otp:used:${h}:${purpose}`;
  }

  //  public API 

  /**
   * Check per-email rate limit: max 5 OTP requests per 15 minutes.
   * Throws RateLimitException if limit exceeded.
   */
  async checkRateLimit(emailHash: string, purpose: string): Promise<void> {
    const key = this.rateLimitKey(emailHash, purpose);
    const count = await this.redis.incr(key);
    // Set TTL on first increment (atomic via Lua is not needed here since
    // a race between INCR and EXPIRE only risks a slightly longer window,
    // not a security bypass — worst case an extra request slips through).
    if (count === 1) {
      await this.redis.expire(key, 900); // 15 minutes
    }
    if (count > 5) {
      throw new RateLimitException(
        'Too many requests. Please try again after 15 minutes.',
      );
    }
  }

  /**
   * Check 60-second cooldown between OTP requests.
   * Throws RateLimitException if within cooldown window.
   */
  async checkCooldown(emailHash: string, purpose: string): Promise<void> {
    const key = this.cooldownKey(emailHash, purpose);
    const exists = await this.redis.exists(key);
    if (exists) {
      throw new RateLimitException(
        'Please wait 60 seconds before requesting a new OTP code.',
      );
    }
  }

  /**
   * Store OTP data and set cooldown in a single pipelined operation.
   */
  async storeOtp(
    emailHash: string,
    purpose: string,
    otpHmac: string,
    keycloakUserId: string | null,
    ip: string,
  ): Promise<void> {
    const payload: OtpPayload = {
      otpHmac,
      keycloakUserId,
      purpose,
      ip,
      createdAt: new Date().toISOString(),
    };
    const pipeline = this.redis.pipeline();
    pipeline.set(this.dataKey(emailHash, purpose), JSON.stringify(payload), 'EX', 600);
    pipeline.set(this.cooldownKey(emailHash, purpose), '1', 'EX', 60, 'NX');
    await pipeline.exec();
  }

  /**
   * Retrieve stored OTP payload. Returns null if expired or not found.
   */
  async getOtp(emailHash: string, purpose: string): Promise<OtpPayload | null> {
    const raw = await this.redis.get(this.dataKey(emailHash, purpose));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OtpPayload;
    } catch {
      return null;
    }
  }

  /**
   * Atomically increment the attempts counter.
   * Sets TTL of 600s on first increment to match OTP lifetime.
   * Returns the new attempt count.
   */
  async incrementAttempts(emailHash: string, purpose: string): Promise<number> {
    const key = this.attemptsKey(emailHash, purpose);
    // Lua script: INCR + EXPIRE on first increment — atomic, prevents race condition
    const luaScript = `
      local n = redis.call('INCR', KEYS[1])
      if n == 1 then
        redis.call('EXPIRE', KEYS[1], 600)
      end
      return n
    `;
    const result = await this.redis.eval(luaScript, 1, key) as number;
    return result;
  }

  /**
   * Mark OTP as used via SETNX — guarantees one-time use even under concurrent requests.
   * Returns true if this call claimed the OTP (first use), false if already used.
   */
  async markUsed(emailHash: string, purpose: string): Promise<boolean> {
    const key = this.usedKey(emailHash, purpose);
    const result = await this.redis.set(key, '1', 'EX', 600, 'NX');
    // SETNX returns 'OK' on success, null if key already exists
    return result === 'OK';
  }

  /**
   * Delete all OTP-related keys atomically via pipeline.
   */
  async deleteOtp(emailHash: string, purpose: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(this.dataKey(emailHash, purpose));
    pipeline.del(this.attemptsKey(emailHash, purpose));
    pipeline.del(this.usedKey(emailHash, purpose));
    await pipeline.exec();
  }

  //  Reset-token store 

  private resetTokenKey(token: string): string {
    return `auth:reset-token:${token}`;
  }

  /**
   * Persist a short-lived reset token that links to a keycloakUserId and email.
   * Generated after OTP is successfully verified (step 2).
   */
  async storeResetToken(
    token: string,
    keycloakUserId: string,
    email: string,
    ttlSec: number,
  ): Promise<void> {
    await this.redis.set(
      this.resetTokenKey(token),
      JSON.stringify({ keycloakUserId, email }),
      'EX',
      ttlSec,
    );
  }

  /**
   * Atomically read and delete a reset token (one-time use via GETDEL).
   * Returns { keycloakUserId, email } if the token is valid, or null if expired/not found.
   */
  async getAndDeleteResetToken(
    token: string,
  ): Promise<{ keycloakUserId: string; email: string } | null> {
    const raw = await this.redis.getdel(this.resetTokenKey(token));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as { keycloakUserId: string; email: string };
      if (!data.keycloakUserId) return null;
      return { keycloakUserId: data.keycloakUserId, email: data.email ?? '' };
    } catch {
      return null;
    }
  }
}
