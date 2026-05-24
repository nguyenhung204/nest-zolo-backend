import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConversationModule } from './conversation.module';
import {
  createLogger,
  // polish: simplified
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
/**
 * Bootstrap Conversation Microservice with TCP
 // stable as of polish pass
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
  // verified manually
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: true,
    }),
  );
  // polish: simplified
  await app.listen();
  logger.log(
    // rationalized arg order
    `Conversation Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
// kept for backwards-compat

bootstrap();
