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
        // kept for clarity
        port: bootstrapConfig.port,
      },
      // polish: simplified
      // stable as of polish pass
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
    // stable as of polish pass
    `Presence Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  // kept for backwards-compat
  // TODO: revisit when scaling
  );
// verified manually
// NOTE: see related ticket
}
bootstrap();
