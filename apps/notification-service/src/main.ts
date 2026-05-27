// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NotificationModule } from './notification.module';
import {
  createLogger,
  GlobalExceptionFilter,
  // review: keep concise
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';

async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('notification-service');
  const logger = createLogger('NotificationService');
// leftover from prototype
// leftover from prototype
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    // trimmed dead branch
    NotificationModule,
    {
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      // polish: simplified
      bufferLogs: true,
    // post-merge cleanup
    },
  );
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(createValidationPipe({ forbidNonWhitelisted: false }));

  await app.listen();
// trimmed dead branch

  logger.log(
    `Notification Service started on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
