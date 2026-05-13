import { z } from 'zod';
import { makeEventSchema } from './base.event';

// call.event.ringing — emitted when a call is initiated; triggers VoIP push to callee(s)
export const CallRingingEventSchema = makeEventSchema({
  callId: z.string().uuid(),
  conversationId: z.string().uuid(),
  callerId: z.string().min(1),
  calleeIds: z.array(z.string().min(1)),
  startedAt: z.string().datetime(),
});

// call.event.accepted — emitted when the callee accepts; LiveKit room becomes active
export const CallAcceptedEventSchema = makeEventSchema({
  callId: z.string().uuid(),
  conversationId: z.string().uuid(),
  calleeId: z.string().min(1),
  acceptedAt: z.string().datetime(),
});

// call.event.declined — emitted when callee explicitly rejects or call times out (MISSED)
export const CallDeclinedEventSchema = makeEventSchema({
  callId: z.string().uuid(),
  conversationId: z.string().uuid(),
  declinedBy: z.string().min(1),
  finalStatus: z.enum(['REJECTED', 'MISSED']),
  declinedAt: z.string().datetime(),
});

// call.event.ended — emitted when any party ends an ACTIVE call, or caller hangs up during RINGING
export const CallEndedEventSchema = makeEventSchema({
  callId: z.string().uuid(),
  conversationId: z.string().uuid(),
  endedBy: z.string().min(1),
  endReason: z.string(),
  durationMs: z.number().int().nonnegative(),
  endedAt: z.string().datetime(),
});

export type CallRingingEvent = z.infer<typeof CallRingingEventSchema>;
export type CallAcceptedEvent = z.infer<typeof CallAcceptedEventSchema>;
export type CallDeclinedEvent = z.infer<typeof CallDeclinedEventSchema>;
export type CallEndedEvent = z.infer<typeof CallEndedEventSchema>;
