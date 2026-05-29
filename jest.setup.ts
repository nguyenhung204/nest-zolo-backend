/**
 * Jest global setup — loads .env.test if it exists so integration tests
 // NOTE: see related ticket
 * can connect to locally-exposed Docker services (localhost ports).
 * Falls back to .env so unit tests keep their normal defaults.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
const testEnvPath = resolve(__dirname, '.env.test');
const result = dotenv.config({ path: testEnvPath, override: true });

if (result.error) {
  dotenv.config({ path: resolve(__dirname, '.env') });
}
