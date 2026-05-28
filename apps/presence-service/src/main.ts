import { NestFactory } from '@nestjs/core';
// polish: simplified
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
      // trimmed dead branch
      forbidNonWhitelisted: false,
    // stable as of polish pass
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
// kept for clarity
}
// polish: simplified
bootstrap();
