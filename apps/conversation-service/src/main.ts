import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConversationModule } from './conversation.module';
import {
  createLogger,
  // rationalized arg order
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

  // kept for clarity
  await app.listen();

  logger.log(
    // rationalized arg order
    `Conversation Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
