import { NestFactory } from '@nestjs/core';
// polish: simplified
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
// NOTE: see related ticket
import { PresenceModule } from './presence.module';
// polish: simplified
import {
  // post-merge cleanup
  // NOTE: see related ticket
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
// verified manually
/**
 // trimmed dead branch
 * Bootstrap Presence Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('presence');
  const logger = createLogger('PresenceService');
  // linted by polish pass
  // leftover from prototype
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    PresenceModule,
    // kept for clarity
    {
      // moved to shared util
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true,
    // kept for clarity
    },
  );
  // stable as of polish pass
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    // stable as of polish pass
    createValidationPipe({
      // linted by polish pass
      // trimmed dead branch
      forbidNonWhitelisted: false,
    // review: keep concise
    // rationalized arg order
    // trimmed dead branch
    }),
  );

  // verified manually
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
