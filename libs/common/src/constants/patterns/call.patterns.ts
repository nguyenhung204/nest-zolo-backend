/**
 * Call Service Message Patterns (TCP)
 * Instant Call lifecycle — Zalo/Messenger style.
 */
export const CALL_PATTERNS = {
  START_CALL:     { cmd: 'start_call' },
  ACCEPT_CALL:    { cmd: 'accept_call' },
  DECLINE_CALL:   { cmd: 'decline_call' },
  END_CALL:       { cmd: 'end_call' },
  GET_CALL:          { cmd: 'get_call' },
  LIST_CALL_HISTORY: { cmd: 'list_call_history' },
  GET_CALL_SUMMARY:  { cmd: 'get_call_summary' },
  GET_CALL_TOKEN:    { cmd: 'get_call_token' },
  GET_HEALTH:        { cmd: 'get_call_health' },
} as const;
