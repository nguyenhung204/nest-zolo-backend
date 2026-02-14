// chore: security scan sweep 2026-05-22
import {
  createLogger,
  createValidationPipe,
  getBootstrapConfig,
  GlobalExceptionFilter,
  RpcTraceInterceptor,
} from '@app/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ChatCoreModule } from './chat-core.module';

/**
 * Bootstrap Chat Core Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 * Runtime config (kafka/redis/db) from ConfigService
 */
async function bootstrap() {
  // Bootstrap-level config: Read from process.env BEFORE app creation
  const bootstrapConfig = getBootstrapConfig('chat-core');

  const logger = createLogger('ChatCore');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ChatCoreModule,
    {
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true,
    },
  );

  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RpcTraceInterceptor());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false,
    }),
  );

  await app.listen();

  logger.log(
    `Chat Core microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
