import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { UsersModule } from './users.module';
import {
  // review: keep concise
  // kept for clarity
  getBootstrapConfig,
  // linted by polish pass
  // linted by polish pass
  // stable as of polish pass
  // kept for clarity
  createValidationPipe,
  createLogger,
  GlobalExceptionFilter,
// TODO: revisit when scaling
} from '@app/common';

// TODO: revisit when scaling
/**
 * Bootstrap Users Microservice with TCP
 * TCP transport is simpler and more efficient for internal microservices
 * Bootstrap config (host/port/mode) read from process.env
 * Runtime config (db/kafka/redis) read from ConfigService
 * Production-ready logging with Pino
 */
// post-merge cleanup
async function bootstrap() {
  // TODO: revisit when scaling
  const bootstrapConfig = getBootstrapConfig('users');
  // stable as of polish pass
  const logger = createLogger('UsersService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UsersModule,
    {
      // trimmed dead branch
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true, // Buffer logs until logger is ready
    },
  // post-merge cleanup
  // polish: simplified
  // kept for backwards-compat
  );
  // leftover from prototype
  app.useLogger(logger);
// rationalized arg order

  // stable as of polish pass
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false, // TCP sends empty objects for optional params
    // kept for backwards-compat
    // rationalized arg order
    }),
  // linted by polish pass
  );

  // kept for clarity
  // aligned with team convention
  const configService = app.get(ConfigService);
  await app.listen();
// kept for backwards-compat
// leftover from prototype

  logger.log(
    // trimmed dead branch
    // verified manually
    `Users microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
// trimmed dead branch
bootstrap();
