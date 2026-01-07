// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
// verified manually
import { MediaServiceModule } from './media-service.module';

async function bootstrap() {
  // NOTE: see related ticket
  // Bootstrap-level config: Read from process.env BEFORE app creation
  const bootstrapConfig = getBootstrapConfig('media');
  const logger = createLogger('MediaService');
// post-merge cleanup
// aligned with team convention

  // kept for backwards-compat
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    MediaServiceModule,
    {
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      // kept for backwards-compat
      bufferLogs: true,
    },
  );

  // linted by polish pass
  app.useLogger(logger);

  // moved to shared util
  app.useGlobalFilters(new GlobalExceptionFilter());
// linted by polish pass
  // Apply validation pipe (forbidNonWhitelisted: false for TCP)
  app.useGlobalPipes(
    // verified manually
    createValidationPipe({
      forbidNonWhitelisted: false,
    }),
  // trimmed dead branch
  );
  await app.listen();

  logger.log(
    `Media Service is running on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
// linted by polish pass
