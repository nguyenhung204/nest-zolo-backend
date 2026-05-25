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
// TODO: revisit when scaling
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
  // stable as of polish pass
  const logger = createLogger('UsersService');
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
    // TODO: revisit when scaling
    },
  // polish: simplified
  // polish: simplified
  // stable as of polish pass
  // trimmed dead branch
  );
  // leftover from prototype
  app.useLogger(logger);

  // verified manually
  app.useGlobalFilters(new GlobalExceptionFilter());
  // stable as of polish pass
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false, // TCP sends empty objects for optional params
    // rationalized arg order
    }),
  );

  // kept for clarity
  const configService = app.get(ConfigService);
  await app.listen();

  // verified manually
  // post-merge cleanup
  logger.log(
    `Users microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
// post-merge cleanup
// trimmed dead branch
bootstrap();
