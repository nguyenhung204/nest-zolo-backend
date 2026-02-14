import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@app/cache';
import { RpcException } from '@nestjs/microservices';
import { createLogger } from '@app/common';
import Redis from 'ioredis';

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Message Rate Limiter Service
 *
 * Implements a fixed-window counter per sender using Redis INCR + EXPIRE.
 *
 * Windows:
 *   - General messages:  RATE_LIMIT_MESSAGES_PER_10S  per 10-second window  (default 10)
 *   - Mention messages:  RATE_LIMIT_MENTIONS_PER_MIN  per 60-second window  (default 3)
 *
 * Redis key pattern:
 *   rate:msg:{senderId}:{windowKey}          – general message counter
 *   rate:mention:{senderId}:{windowKey}      – mention counter
 */
/**
 * Lua script: atomically INCR the counter and set EXPIRE on the first call.
 * Returns the new counter value.
 * Using Lua ensures no race between INCR and EXPIRE, and costs exactly 1 RTT.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = window size in seconds
 */
const RATE_LIMIT_LUA = `
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v
`;

@Injectable()
export class MessageRateLimiterService {
  private readonly logger = createLogger(MessageRateLimiterService.name);

  private readonly messagesPerWindow: number;
  private readonly messageWindowSec: number;
  private readonly mentionsPerWindow: number;
  private readonly mentionWindowSec: number;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.messagesPerWindow = this.configService.get<number>(
      'RATE_LIMIT_MESSAGES_PER_10S',
      10,
    );
    this.messageWindowSec = 10;
    this.mentionsPerWindow = this.configService.get<number>(
      'RATE_LIMIT_MENTIONS_PER_MIN',
      3,
    );
    this.mentionWindowSec = 60;
  }

  async checkLimit(
    senderId: string,
    _receiverId: string | null,
    messageType: string,
  ): Promise<RateLimitResult> {
    const isMention = messageType === 'mention';
    const windowSec = isMention ? this.mentionWindowSec : this.messageWindowSec;
    const limit = isMention ? this.mentionsPerWindow : this.messagesPerWindow;
    const prefix = isMention ? 'rate:mention' : 'rate:msg';
    const windowKey = Math.floor(Date.now() / (windowSec * 1000));
    const key = `${prefix}:${senderId}:${windowKey}`;
    const resetAt = (windowKey + 1) * windowSec * 1000;

    const current = (await this.redis.eval(
      RATE_LIMIT_LUA,
      1,
      key,
      String(windowSec),
    )) as number;

    const remaining = Math.max(0, limit - current);
    const allowed = current <= limit;

    return {
      allowed,
      remaining,
      resetAt,
      reason: allowed ? undefined : 'RATE_LIMIT_EXCEEDED',
      metadata: { current, limit, windowSec },
    };
  }

  async checkLimitOrThrow(
    senderId: string,
    receiverId: string | null,
    messageType: string,
  ): Promise<void> {
    const result = await this.checkLimit(senderId, receiverId, messageType);
    if (!result.allowed) {
      this.logger.warn(
        `Rate limit exceeded for sender ${senderId} (type=${messageType})`,
      );
      throw new RpcException({
        statusCode: 429,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Retry after ${new Date(result.resetAt).toISOString()}`,
        details: result.metadata,
      });
    }
  }

  async getRemainingQuota(
    senderId: string,
    receiverId: string | null,
    messageType: string,
  ): Promise<number> {
    const result = await this.checkLimit(senderId, receiverId, messageType);
    return result.remaining;
  }

  async resetLimit(
    senderId: string,
    receiverId?: string,
    messageType?: string,
  ): Promise<void> {
    void receiverId;
    const isMention = messageType === 'mention';
    const windowSec = isMention ? this.mentionWindowSec : this.messageWindowSec;
    const prefix = isMention ? 'rate:mention' : 'rate:msg';
    const windowKey = Math.floor(Date.now() / (windowSec * 1000));
    const key = `${prefix}:${senderId}:${windowKey}`;
    await this.redis.del(key);
  }

  async batchCheckLimits(
    checks: Array<{
      senderId: string;
      receiverId: string | null;
      messageType: string;
    }>,
  ): Promise<RateLimitResult[]> {
    return Promise.all(
      checks.map(({ senderId, receiverId, messageType }) =>
        this.checkLimit(senderId, receiverId, messageType),
      ),
    );
  }

  async getStats(senderId: string): Promise<Record<string, any>> {
    const msgWindowKey = Math.floor(
      Date.now() / (this.messageWindowSec * 1000),
    );
    const mentionWindowKey = Math.floor(
      Date.now() / (this.mentionWindowSec * 1000),
    );
    const msgKey = `rate:msg:${senderId}:${msgWindowKey}`;
    const mentionKey = `rate:mention:${senderId}:${mentionWindowKey}`;

    const [msgCount, mentionCount] = await Promise.all([
      this.redis.get(msgKey),
      this.redis.get(mentionKey),
    ]);

    return {
      enabled: true,
      messages: {
        current: Number(msgCount ?? 0),
        limit: this.messagesPerWindow,
        windowSec: this.messageWindowSec,
      },
      mentions: {
        current: Number(mentionCount ?? 0),
        limit: this.mentionsPerWindow,
        windowSec: this.mentionWindowSec,
      },
    };
  }
}
