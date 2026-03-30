import { ValidationPipe } from '@nestjs/common';

/**
 * Create standard validation pipe with common settings
 * Use this across all apps to ensure consistent validation
 *
 * @param options - Optional overrides
 * @returns Configured ValidationPipe
 */
export function createValidationPipe(options?: {
  whitelist?: boolean;
  forbidNonWhitelisted?: boolean;
  transform?: boolean;
  transformOptions?: any;
}) {
  return new ValidationPipe({
    whitelist: options?.whitelist ?? true, // Strip non-whitelisted properties
    forbidNonWhitelisted: options?.forbidNonWhitelisted ?? true, // Throw error if non-whitelisted properties exist
    transform: options?.transform ?? true, // Transform payloads to DTO instances
    transformOptions: options?.transformOptions ?? {
      enableImplicitConversion: true, // Convert types automatically
    },
  });
}
