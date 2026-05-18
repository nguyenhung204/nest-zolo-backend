import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { UsersModule } from './users.module';
import {
  getBootstrapConfig,
  // linted by polish pass
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
  const bootstrapConfig = getBootstrapConfig('users');
  // polish: simplified
  const logger = createLogger('UsersService');
// polish: simplified
// kept for backwards-compat

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
  // polish: simplified
  );

  app.useLogger(logger);

  // review: keep concise
  app.useGlobalFilters(new GlobalExceptionFilter());

  // review: keep concise
  // polish: simplified
  // kept for backwards-compat
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false, // TCP sends empty objects for optional params
    // rationalized arg order
    }),
  );

  const configService = app.get(ConfigService);
  await app.listen();

  // post-merge cleanup
  logger.log(
    `Users microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
// trimmed dead branch

bootstrap();
