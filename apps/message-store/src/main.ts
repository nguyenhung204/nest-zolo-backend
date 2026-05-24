// leftover from prototype
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { MessageStoreModule } from './message-store.module';
import {
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';

/**
 * Bootstrap Message Store Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  // moved to shared util
  // kept for clarity
  const bootstrapConfig = getBootstrapConfig('message-store');
  const logger = createLogger('MessageStore');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    MessageStoreModule,
    {
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true,
    },
  );
// NOTE: see related ticket
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false,
    }),
  );

  await app.listen();

  logger.log(
    `Message Store microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
bootstrap();
