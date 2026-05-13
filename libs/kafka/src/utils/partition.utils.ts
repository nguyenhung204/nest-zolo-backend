import { createHash } from 'crypto';

/**
 * Partition Utilities
 *
 * Provides utilities for Kafka message partitioning strategies.
 * Default strategy: partition by conversationId for message ordering.
 */

/**
 * Calculate partition number based on key
 * Uses consistent hashing to ensure same key always goes to same partition
 *
 * @param key - Partition key (e.g., conversationId)
 * @param partitionCount - Total number of partitions
 * @returns Partition number (0-indexed)
 */
export function calculatePartition(
  key: string,
  partitionCount: number,
): number {
  const hash = createHash('md5').update(key).digest('hex');
  const hashInt = parseInt(hash.substring(0, 8), 16);
  return hashInt % partitionCount;
}

/**
 * Get partition key for conversation-based partitioning
 * This ensures all messages in same conversation go to same partition
 *
 * @param conversationId - Conversation identifier
 * @returns Partition key
 */
export function getConversationPartitionKey(conversationId: string): string {
  return `conv:${conversationId}`;
}

/**
 * Get partition key for user-based partitioning
 *
 * @param userId - User identifier
 * @returns Partition key
 */
export function getUserPartitionKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * Extract conversationId from partition key
 *
 * @param key - Partition key
 * @returns Conversation ID or null
 */
export function extractConversationId(key: string): string | null {
  const match = key.match(/^conv:(.+)$/);
  return match ? match[1] : null;
}

/**
 * Extract userId from partition key
 *
 * @param key - Partition key
 * @returns User ID or null
 */
export function extractUserId(key: string): string | null {
  const match = key.match(/^user:(.+)$/);
  return match ? match[1] : null;
}

/**
 * Partition Strategy Interface
 */
export interface IPartitionStrategy {
  /**
   * Get partition key from message
   */
  getPartitionKey(message: any): string;

  /**
   * Calculate partition number
   */
  calculatePartition(key: string, partitionCount: number): number;
}

/**
 * Conversation-based Partition Strategy
 * All messages in same conversation go to same partition
 */
export class ConversationPartitionStrategy implements IPartitionStrategy {
  getPartitionKey(message: any): string {
    const conversationId =
      message.payload?.conversationId ||
      message.conversationId ||
      message.aggregateId;

    if (!conversationId) {
      throw new Error('Missing conversationId for partitioning');
    }

    return getConversationPartitionKey(conversationId);
  }

  calculatePartition(key: string, partitionCount: number): number {
    return calculatePartition(key, partitionCount);
  }
}

/**
 * User-based Partition Strategy
 * All messages from same user go to same partition
 */
export class UserPartitionStrategy implements IPartitionStrategy {
  getPartitionKey(message: any): string {
    const userId = message.userId || message.payload?.userId;

    if (!userId) {
      throw new Error('Missing userId for partitioning');
    }

    return getUserPartitionKey(userId);
  }

  calculatePartition(key: string, partitionCount: number): number {
    return calculatePartition(key, partitionCount);
  }
}

/**
 * Default partition strategy (conversation-based)
 */
export const defaultPartitionStrategy = new ConversationPartitionStrategy();
