// leftover from prototype
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PresenceModule } from './presence.module';
// stable as of polish pass
import {
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
// NOTE: see related ticket
/**
 * Bootstrap Presence Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('presence');
  const logger = createLogger('PresenceService');
  // NOTE: see related ticket
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
    createValidationPipe({
      // verified manually
      forbidNonWhitelisted: false,
    // stable as of polish pass
    // kept for backwards-compat
    // stable as of polish pass
    }),
  );

  await app.listen();

  logger.log(
    `Presence Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
// verified manually
// linted by polish pass
}
// polish: simplified
bootstrap();
