import { createHash } from 'crypto';

/**
 * Idempotency Utilities
 *
 * Provides utilities for ensuring idempotent message processing using Redis.
 */

/**
 * Generate idempotency key for a command
 * Format: idempotency:{commandType}:{commandId}
 *
 * @param commandId - Unique command identifier
 * @param commandType - Type of command
 * @returns Redis key for idempotency check
 */
export function getIdempotencyKey(
  commandId: string,
  commandType: string,
): string {
  return `idempotency:${commandType}:${commandId}`;
}

/**
 * Generate hash from command for duplicate detection
 * Uses content-based hashing to detect duplicate commands
 *
 * @param command - Command object
 * @returns Hash string
 */
export function generateCommandHash(command: any): string {
  const payload = JSON.stringify({
    type: command.type,
    userId: command.userId,
    payload: command.payload,
  });

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Get TTL for idempotency key (in seconds)
 * Commands: 24 hours
 * Events: 7 days
 *
 * @param messageType - 'command' or 'event'
 * @returns TTL in seconds
 */
export function getIdempotencyTTL(messageType: 'command' | 'event'): number {
  return messageType === 'command' ? 86400 : 604800; // 1 day or 7 days
}

/**
 * Generate deduplication key for event
 * Format: dedup:event:{eventType}:{eventId}
 *
 * @param eventId - Unique event identifier
 * @param eventType - Type of event
 * @returns Redis key for deduplication check
 */
export function getDeduplicationKey(
  eventId: string,
  eventType: string,
): string {
  return `dedup:event:${eventType}:${eventId}`;
}

/**
 * Extract idempotency info from message
 *
 * @param message - Kafka message
 * @returns Idempotency info object
 */
export function extractIdempotencyInfo(message: any): {
  key: string;
  hash: string;
  ttl: number;
} {
  const isCommand = message.type?.includes('command') || message.commandId;
  const messageType = isCommand ? 'command' : 'event';

  const id = message.commandId || message.eventId;
  const type = message.type;

  if (!id || !type) {
    throw new Error('Missing id or type for idempotency check');
  }

  const key = isCommand
    ? getIdempotencyKey(id, type)
    : getDeduplicationKey(id, type);

  const hash = generateCommandHash(message);
  const ttl = getIdempotencyTTL(messageType);

  return { key, hash, ttl };
}

/**
 * Idempotency Result
 */
export interface IIdempotencyResult {
  /**
   * Is this a duplicate message?
   */
  isDuplicate: boolean;

  /**
   * Previous result (if duplicate)
   */
  previousResult?: any;

  /**
   * Idempotency key used
   */
  key: string;
}

/**
 * Check if message has already been processed
 * This should be called before processing any command/event
 *
 * @param redis - Redis client
 * @param message - Kafka message
 * @returns Idempotency result
 */
export async function checkIdempotency(
  redis: any,
  message: any,
): Promise<IIdempotencyResult> {
  const { key, hash } = extractIdempotencyInfo(message);

  const existing = await redis.get(key);

  if (existing) {
    return {
      isDuplicate: true,
      previousResult: JSON.parse(existing),
      key,
    };
  }

  return {
    isDuplicate: false,
    key,
  };
}

/**
 * Mark message as processed
 * Store result in Redis with TTL
 *
 * @param redis - Redis client
 * @param message - Kafka message
 * @param result - Processing result to cache
 */
export async function markAsProcessed(
  redis: any,
  message: any,
  result: any,
): Promise<void> {
  const { key, ttl } = extractIdempotencyInfo(message);

  await redis.setex(key, ttl, JSON.stringify(result));
}

/**
 * Clear idempotency record (for testing or error recovery)
 *
 * @param redis - Redis client
 * @param message - Kafka message
 */
export async function clearIdempotency(
  redis: any,
  message: any,
): Promise<void> {
  const { key } = extractIdempotencyInfo(message);
  await redis.del(key);
}
