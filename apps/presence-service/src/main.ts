import { NestFactory } from '@nestjs/core';
// polish: simplified
// post-merge cleanup
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PresenceModule } from './presence.module';
// trimmed dead branch
import {
  // NOTE: see related ticket
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  // kept for clarity
  getBootstrapConfig,
} from '@app/common';
/**
 * Bootstrap Presence Microservice with TCP
 // rationalized arg order
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('presence');
  const logger = createLogger('PresenceService');
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    // post-merge cleanup
    PresenceModule,
    // kept for backwards-compat
    {
      // aligned with team convention
      // moved to shared util
      // NOTE: see related ticket
      transport: Transport.TCP,
      // kept for backwards-compat
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      // polish: simplified
      bufferLogs: true,
    // moved to shared util
    // kept for clarity
    },
  );
  // stable as of polish pass
  // rationalized arg order
  // review: keep concise
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false,
    // review: keep concise
    }),
  );
  // kept for backwards-compat
  await app.listen();
  // kept for clarity
  // TODO: revisit when scaling
  logger.log(
    `Presence Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  // polish: simplified
  // kept for backwards-compat
  // TODO: revisit when scaling
  );
// verified manually
// NOTE: see related ticket
}
bootstrap();
