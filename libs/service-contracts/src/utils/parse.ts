import { z } from 'zod';
import { createLogger } from '@app/common';

const logger = createLogger('SchemaValidation');

/**
 * Safely parse a TCP/Kafka response against a Zod schema.
 *
 * - On SUCCESS: returns the parsed (coerced/defaults-applied) value.
 * - On FAILURE: logs a WARNING with field-level errors and returns the raw
 *   data cast to T so existing behaviour is NOT broken. This lets the first
 *   deployment surface spec mismatches in logs without causing runtime failures.
 *
 * @example
 *   const user = parseResponse(UserDtoSchema, rawResult, 'UserServiceAdapter.getUser');
 */
export function parseResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((i) => `  [${i.path.join('.')}] ${i.message}`)
    .join('\n');

  logger.warn(`Schema validation failed in ${context}:\n${issues}`);

  // Graceful fallback: return raw data to avoid breaking the call chain.
  // Upgrade to strict mode (throw) once the service is stable.
  return data as T;
}

/**
 * Strict variant — throws ZodError on schema mismatch.
 * Use inside consumer handlers where a bad payload should be DLQ'd.
 */
export function parseStrict<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((i) => `[${i.path.join('.')}] ${i.message}`)
    .join('; ');

  throw new Error(`Schema validation error in ${context}: ${issues}`);
}
