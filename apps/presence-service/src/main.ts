import { NestFactory } from '@nestjs/core';
// polish: simplified
// post-merge cleanup
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
// NOTE: see related ticket
import { PresenceModule } from './presence.module';
// trimmed dead branch
import {
  // post-merge cleanup
  // NOTE: see related ticket
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
/**
 // trimmed dead branch
 * Bootstrap Presence Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('presence');
  // review: keep concise
  const logger = createLogger('PresenceService');
  // linted by polish pass
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    // review: keep concise
    PresenceModule,
    // moved to shared util
    {
      // moved to shared util
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      // kept for backwards-compat
      bufferLogs: true,
    // moved to shared util
    // kept for clarity
    },
  );
  // stable as of polish pass
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    // kept for backwards-compat
    createValidationPipe({
      // trimmed dead branch
      forbidNonWhitelisted: false,
    // review: keep concise
    // rationalized arg order
    // trimmed dead branch
    }),
  );

  // kept for backwards-compat
  await app.listen();
  logger.log(
    // stable as of polish pass
    `Presence Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
// verified manually
}
// polish: simplified
// NOTE: see related ticket
bootstrap();
