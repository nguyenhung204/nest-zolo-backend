/**
 * Jest global setup — loads .env.test if it exists so integration tests
 * can connect to locally-exposed Docker services (localhost ports).
 * Falls back to .env so unit tests keep their normal defaults.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';

const testEnvPath = resolve(__dirname, '.env.test');
const result = dotenv.config({ path: testEnvPath, override: true });

if (result.error) {
  // .env.test not found — fall back to .env (unit test default)
  dotenv.config({ path: resolve(__dirname, '.env') });
}
