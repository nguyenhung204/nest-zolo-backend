// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { UsersModule } from './users.module';
import {
  getBootstrapConfig,
  createValidationPipe,
  createLogger,
  GlobalExceptionFilter,
} from '@app/common';

/**
 * Bootstrap Users Microservice with TCP
 * TCP transport is simpler and more efficient for internal microservices
 * Bootstrap config (host/port/mode) read from process.env
 * Runtime config (db/kafka/redis) read from ConfigService
 * Production-ready logging with Pino
 */
async function bootstrap() {
  // Bootstrap-level config: Read from process.env BEFORE app creation
  const bootstrapConfig = getBootstrapConfig('users');

  // Create logger
  const logger = createLogger('UsersService');

  // Create microservice with bootstrap config
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UsersModule,
    {
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true, // Buffer logs until logger is ready
    },
  );

  // Use custom logger for structured logging
  app.useLogger(logger);

  // Apply Global Exception Filter for consistent error handling
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Enable validation globally with TCP-friendly config
  // Note: forbidNonWhitelisted must be false for TCP to allow empty objects {}
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false, // TCP sends empty objects for optional params
    }),
  );

  // Get ConfigService for runtime config (db, kafka, etc.)
  const configService = app.get(ConfigService);

  await app.listen();

  logger.log(
    `Users microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
