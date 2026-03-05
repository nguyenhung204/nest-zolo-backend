import { Injectable } from '@nestjs/common';
import { KafkaHandler, CONSUMER_GROUPS } from '@app/kafka';
import { createLogger, KAFKA_TOPICS, REDIS_KEYS, REDIS_TTL } from '@app/common';
import { InjectRedis } from '@app/cache';
import Redis from 'ioredis';
import {
  FriendRequestAcceptedEventSchema,
  FriendshipRemovedEventSchema,
  parseResponse,
} from '@app/service-contracts';

/**
 * Friendship Friends Consumer (Chat Core)
 *
 * Responsibility: Maintain a Redis cache of "are these two users friends?" so
 * that ChatCore can skip the friendship-service TCP call on every DIRECT message.
 *
 * Cache key: {chat:rel:{lo}:{hi}}:friends  (Hash Tag ensures same Redis Cluster slot as block/proof)
 *
 * Value semantics (LWW Register — clock-skew-safe, out-of-order-safe):
 *   Positive Unix-ms string → friends (set at this Kafka broker timestamp)
 *   Negative Unix-ms string → tombstone: removed (set at this Kafka broker timestamp)
 *
 * Clock source: Kafka broker log-append time (message.timestamp from EachMessagePayload).
 *   This is stamped by the broker when it commits the batch to the partition log — immune
 *   to application Pod clock skew. A Pod whose wall clock drifts 500ms forward cannot
 *   produce a timestamp that out-races events that were physically committed later.
 *
 * Win condition for a write: |new_broker_ts| > |stored_ts|.
 *   Enforced atomically by a Lua CAS script loaded as a named ioredis command (EVALSHA).
 *
 * TTL strategy:
 *   Positive (friends): 30-day safety-net TTL; primary eviction is event-driven tombstone.
 *   Negative (tombstone): 60-second TTL — long enough to beat Kafka redelivery lag.
 *
 * Orchestrator reads: parseInt(value) > 0  →  currently friends.
 */
@Injectable()
export class FriendshipFriendsConsumer {
  private readonly logger = createLogger(FriendshipFriendsConsumer.name);

  /**
   * Lua Compare-And-Set by |timestamp| — ACCEPTED path (writes positive ts).
   *
   * ioredis `defineCommand` compiles this script on first call via SCRIPT LOAD,
   * then invokes it as EVALSHA on subsequent calls — only 40-char SHA1 + args
   * travel over the wire, reducing per-call payload ~90% vs raw EVAL.
   * ioredis automatically falls back to EVAL on NOSCRIPT errors (e.g. after
   * a Redis restart that clears the script cache).
   *
   * KEYS[1] = cache key
   * ARGV[1] = new timestamp (positive integer string, Unix ms)
   * ARGV[2] = TTL in seconds
   */
  private static readonly LUA_CAS_SET = `
    local cur = redis.call('GET', KEYS[1])
    local newTs = tonumber(ARGV[1])
    if cur == false or math.abs(tonumber(cur)) < newTs then
      redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
    end
    return 1
  `;

  /**
   * Lua Compare-And-Set tombstone — REMOVED path (writes negative ts, short TTL).
   * Same |ts| guard; stores '-' .. ARGV[1] so the orchestrator sees parseInt() < 0.
   *
   * KEYS[1] = cache key
   * ARGV[1] = new timestamp (positive integer string, Unix ms)
   * ARGV[2] = tombstone TTL in seconds
   */
  private static readonly LUA_CAS_TOMBSTONE = `
    local cur = redis.call('GET', KEYS[1])
    local newTs = tonumber(ARGV[1])
    if cur == false or math.abs(tonumber(cur)) < newTs then
      redis.call('SET', KEYS[1], '-' .. ARGV[1], 'EX', tonumber(ARGV[2]))
    end
    return 1
  `;

  constructor(@InjectRedis() private readonly redis: Redis) {
    // Register both scripts as named commands.
    // ioredis will call SCRIPT LOAD the first time and EVALSHA thereafter,
    // falling back to EVAL automatically on NOSCRIPT (e.g. Redis restart).
    (this.redis as any).defineCommand('friendsCasSet', {
      numberOfKeys: 1,
      lua: FriendshipFriendsConsumer.LUA_CAS_SET,
    });
    (this.redis as any).defineCommand('friendsCasTombstone', {
      numberOfKeys: 1,
      lua: FriendshipFriendsConsumer.LUA_CAS_TOMBSTONE,
    });
  }

  /**
   * Handle FRIENDSHIP.REQUEST_ACCEPTED events.
   *
   * Clock source: message.timestamp = Kafka broker log-append time (Unix ms string).
   * This is stamped by the broker — immune to application Pod clock skew.
   * Uses EVALSHA (friendsCasSet command) to minimise per-call network payload.
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
    groupId: CONSUMER_GROUPS.CHAT_CORE_FRIEND_CACHE,
    fromBeginning: false,
  })
  async handleFriendRequestAccepted(message: any): Promise<void> {
    try {
      const event = parseResponse(
        FriendRequestAcceptedEventSchema,
        message,
        'FriendshipFriendsConsumer.handleFriendRequestAccepted',
      );
      const { userA, userB } = event;

      // Prefer Kafka broker log-append time for clock-skew immunity.
      // message.timestamp is set by the broker when it commits the record.
      const ts = message.timestamp
        ? parseInt(message.timestamp as string, 10)
        : Date.now();

      const key = REDIS_KEYS.CHAT.FRIENDSHIP_FRIENDS(userA, userB);
      await (this.redis as any).friendsCasSet(
        key,
        ts.toString(),
        REDIS_TTL.CHAT.FRIENDSHIP_FRIENDS.toString(),
      );

      this.logger.log(`[FRIENDS] Cached friendship ${userA} ↔ ${userB} (broker_ts=${ts})`);
    } catch (error: unknown) {
      this.logger.error(
        'Failed to cache FRIENDSHIP.REQUEST_ACCEPTED event',
        (error as Error).stack,
      );
      // Best-effort — do not rethrow; cache miss falls back to TCP
    }
  }

  /**
   * Handle FRIENDSHIP.REMOVED events.
   *
   * Writes a negative tombstone at Kafka broker timestamp.
   * 60s TTL covers Kafka redelivery lag; if a lagging ACCEPTED event arrives
   * later it will be discarded by the CAS guard (its broker_ts < tombstone ts).
   */
  @KafkaHandler({
    topic: KAFKA_TOPICS.FRIENDSHIP.REMOVED,
    groupId: CONSUMER_GROUPS.CHAT_CORE_FRIEND_CACHE,
    fromBeginning: false,
  })
  async handleFriendshipRemoved(message: any): Promise<void> {
    try {
      const event = parseResponse(
        FriendshipRemovedEventSchema,
        message,
        'FriendshipFriendsConsumer.handleFriendshipRemoved',
      );
      const { userA, userB } = event;

      const ts = message.timestamp
        ? parseInt(message.timestamp as string, 10)
        : Date.now();

      const key = REDIS_KEYS.CHAT.FRIENDSHIP_FRIENDS(userA, userB);
      await (this.redis as any).friendsCasTombstone(
        key,
        ts.toString(),
        REDIS_TTL.CHAT.FRIENDSHIP_FRIENDS_TOMBSTONE.toString(),
      );

      this.logger.log(`[UNFRIENDED] Tombstoned friendship cache ${userA} ↔ ${userB} (broker_ts=${ts})`);
    } catch (error: unknown) {
      this.logger.error(
        'Failed to tombstone cache for FRIENDSHIP.REMOVED event',
        (error as Error).stack,
      );
    }
  }
}
