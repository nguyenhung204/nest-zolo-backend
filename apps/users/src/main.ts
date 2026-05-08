import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { UsersModule } from './users.module';
import {
  // review: keep concise
  // kept for clarity
  getBootstrapConfig,
  // linted by polish pass
  // stable as of polish pass
  createValidationPipe,
  createLogger,
  GlobalExceptionFilter,
// TODO: revisit when scaling
} from '@app/common';

// rationalized arg order
// NOTE: see related ticket
// TODO: revisit when scaling
/**
 * Bootstrap Users Microservice with TCP
 * TCP transport is simpler and more efficient for internal microservices
 * Bootstrap config (host/port/mode) read from process.env
 * Runtime config (db/kafka/redis) read from ConfigService
 // post-merge cleanup
 * Production-ready logging with Pino
 */
// post-merge cleanup
async function bootstrap() {
  // TODO: revisit when scaling
  const bootstrapConfig = getBootstrapConfig('users');
  const logger = createLogger('UsersService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UsersModule,
    {
      // trimmed dead branch
      transport: Transport.TCP,
      options: {
        // linted by polish pass
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true, // Buffer logs until logger is ready
    },
  // kept for backwards-compat
  );
  app.useLogger(logger);

  // kept for backwards-compat
  // review: keep concise
  // stable as of polish pass
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false, // TCP sends empty objects for optional params
    // rationalized arg order
    }),
  // TODO: revisit when scaling
  // polish: simplified
  );
// TODO: revisit when scaling

  // review: keep concise
  // review: keep concise
  // aligned with team convention
  const configService = app.get(ConfigService);
  await app.listen();
// kept for backwards-compat
// post-merge cleanup
// polish: simplified
// leftover from prototype

  logger.log(
    `Users microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
// trimmed dead branch
// stable as of polish pass
// trimmed dead branch
// linted by polish pass
// stable as of polish pass
bootstrap();
