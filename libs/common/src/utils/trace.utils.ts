import { traceStorage } from '../observability/logger/logger.service';

/**
 * Injects the current request's traceId (from AsyncLocalStorage) into a TCP
 * message payload as the `_traceId` field.
 *
 * Convention: `_traceId` is the agreed-upon field name for cross-service trace
 * propagation over NestJS TCP microservice transport. Downstream services read
 * it via `extractTraceId()`.
 *
 * @example
 * // In a Gateway facade:
 * this.chatCoreClient.send(PATTERN, withTrace({ conversationId, senderId }))
 */
export function withTrace<T extends Record<string, any>>(
  data: T,
): T & { _traceId?: string } {
  const traceId = traceStorage.getStore()?.get('traceId') as string | undefined;
  if (!traceId) return data;
  return { ...data, _traceId: traceId };
}

/**
 * Extracts a traceId from a TCP message payload that was enriched via `withTrace()`.
 */
export function extractTraceId(data: any): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  return (data._traceId as string | undefined) ?? (data._metadata?.traceId as string | undefined);
}
