import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@app/cache';
import { createLogger } from '@app/common';
import Redis from 'ioredis';

export class CallLockAcquisitionError extends Error {
  constructor(lockKey: string) {
    super(`Failed to acquire call lock: ${lockKey}`);
    this.name = 'CallLockAcquisitionError';
  }
}

interface CallLockOptions {
  ttlMs?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
}

@Injectable()
export class CallLockService {
  private readonly logger = createLogger(CallLockService.name);
  private readonly defaultLockTtlMs: number;
  private readonly defaultWaitTimeoutMs: number;
  private readonly defaultRetryDelayMs: number;
  private readonly cleanupLockTtlMs: number;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.defaultLockTtlMs = Math.max(
      15_000,
      this.configService.get<number>('CALL_LOCK_TTL_MS', 120_000),
    );
    this.defaultWaitTimeoutMs = Math.max(
      500,
      this.configService.get<number>('CALL_LOCK_WAIT_TIMEOUT_MS', 5_000),
    );
    this.defaultRetryDelayMs = Math.max(
      50,
      this.configService.get<number>('CALL_LOCK_RETRY_DELAY_MS', 100),
    );
    this.cleanupLockTtlMs = Math.max(
      30_000,
      this.configService.get<number>('CALL_CLEANUP_LOCK_TTL_MS', 300_000),
    );
  }

  async withConversationLock<T>(
    conversationId: string,
    fn: () => Promise<T>,
    options?: CallLockOptions,
  ): Promise<T> {
    return this.withLock(this.conversationLockKey(conversationId), fn, options);
  }

  async withCallLock<T>(
    callId: string,
    fn: () => Promise<T>,
    options?: CallLockOptions,
  ): Promise<T> {
    return this.withLock(this.callLockKey(callId), fn, options);
  }

  async withUserLock<T>(
    userId: string,
    fn: () => Promise<T>,
    options?: CallLockOptions,
  ): Promise<T> {
    return this.withLock(this.userLockKey(userId), fn, options);
  }

  async tryRunCleanupLeader<T>(fn: () => Promise<T>): Promise<boolean> {
    const acquired = await this.tryAcquire(this.jobLockKey('cleanup'), {
      ttlMs: this.cleanupLockTtlMs,
      waitTimeoutMs: 0,
      retryDelayMs: this.defaultRetryDelayMs,
    });

    if (!acquired) {
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      await this.release(acquired.key, acquired.token);
    }
  }

  private async withLock<T>(
    lockKey: string,
    fn: () => Promise<T>,
    options?: CallLockOptions,
  ): Promise<T> {
    const acquired = await this.tryAcquire(lockKey, options);
    if (!acquired) {
      throw new CallLockAcquisitionError(lockKey);
    }

    try {
      return await fn();
    } finally {
      await this.release(acquired.key, acquired.token);
    }
  }

  private async tryAcquire(
    lockKey: string,
    options?: CallLockOptions,
  ): Promise<{ key: string; token: string } | null> {
    const ttlMs = Math.max(250, options?.ttlMs ?? this.defaultLockTtlMs);
    const waitTimeoutMs = Math.max(
      0,
      options?.waitTimeoutMs ?? this.defaultWaitTimeoutMs,
    );
    const retryDelayMs = Math.max(
      25,
      options?.retryDelayMs ?? this.defaultRetryDelayMs,
    );
    const token = randomUUID();
    const deadline = Date.now() + waitTimeoutMs;

    for (;;) {
      const acquired = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (acquired === 'OK') {
        return { key: lockKey, token };
      }

      if (Date.now() >= deadline) {
        this.logger.warn(`Timed out acquiring lock ${lockKey}`);
        return null;
      }

      await this.sleep(retryDelayMs);
    }
  }

  private async release(lockKey: string, token: string): Promise<void> {
    try {
      await this.redis.eval(
        `
          if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
          end
          return 0
        `,
        1,
        lockKey,
        token,
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to release lock ${lockKey}: ${error?.message || 'unknown_error'}`,
      );
    }
  }

  private conversationLockKey(conversationId: string): string {
    return `call:lock:conversation:${conversationId}`;
  }

  private callLockKey(callId: string): string {
    return `call:lock:meeting:${callId}`;
  }

  private userLockKey(userId: string): string {
    return `call:lock:user:${userId}`;
  }

  private jobLockKey(jobName: string): string {
    return `call:lock:job:${jobName}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
