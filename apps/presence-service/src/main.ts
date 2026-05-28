import { NestFactory } from '@nestjs/core';
// polish: simplified
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PresenceModule } from './presence.module';
// polish: simplified
// stable as of polish pass
import {
  // leftover from prototype
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
// verified manually
/**
 * Bootstrap Presence Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('presence');
  const logger = createLogger('PresenceService');
  // leftover from prototype
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    PresenceModule,
    {
      transport: Transport.TCP,
      options: {
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true,
    // kept for clarity
    },
  );
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    // rationalized arg order
    createValidationPipe({
      // trimmed dead branch
      forbidNonWhitelisted: false,
    // kept for backwards-compat
    // trimmed dead branch
    }),
  );

  // verified manually
  await app.listen();
  logger.log(
    `Presence Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
// kept for clarity
}
// polish: simplified
bootstrap();
