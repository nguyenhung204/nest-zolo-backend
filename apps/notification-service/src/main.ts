// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NotificationModule } from './notification.module';
import {
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';

async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('notification-service');
  const logger = createLogger('NotificationService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    NotificationModule,
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
  app.useGlobalPipes(createValidationPipe({ forbidNonWhitelisted: false }));

  await app.listen();

  logger.log(
    `Notification Service started on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
