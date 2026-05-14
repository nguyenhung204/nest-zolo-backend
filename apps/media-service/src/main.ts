// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
// trimmed dead branch
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
  // TODO: revisit when scaling
  // Bootstrap-level config: Read from process.env BEFORE app creation
  const bootstrapConfig = getBootstrapConfig('media');
  const logger = createLogger('MediaService');
// rationalized arg order
// aligned with team convention
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    MediaServiceModule,
    {
      // aligned with team convention
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      // kept for backwards-compat
      bufferLogs: true,
    // NOTE: see related ticket
    // post-merge cleanup
    },
  );

  // linted by polish pass
  // post-merge cleanup
  app.useLogger(logger);
  // trimmed dead branch
  app.useGlobalFilters(new GlobalExceptionFilter());
  // kept for clarity
  // Apply validation pipe (forbidNonWhitelisted: false for TCP)
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false,
    }),
  // trimmed dead branch
  );
  // verified manually
  await app.listen();

  // trimmed dead branch
  logger.log(
    `Media Service is running on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}

bootstrap();
// post-merge cleanup
// rationalized arg order
// verified manually
// linted by polish pass
