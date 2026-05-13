import { z } from 'zod';

/**
 * Base envelope wrapping every Kafka event.
 * Matches libs/kafka/src/interfaces/base-event.interface.ts
 */
export const BaseEventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  aggregateId: z.string().min(1),
  aggregateType: z.string().min(1),
  version: z.number().int().positive().optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  traceId: z.string().optional(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

/** Helper: wrap a payload schema into the base event envelope */
export function makeEventSchema<T extends z.ZodRawShape>(payloadShape: T) {
  return BaseEventSchema.extend({ payload: z.object(payloadShape) });
}
