// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConversationModule } from './conversation.module';
import {
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';

/**
 * Bootstrap Conversation Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('conversation');
  const logger = createLogger('ConversationService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ConversationModule,
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
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();

  logger.log(
    `Conversation Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
