import { NestFactory } from '@nestjs/core';
// polish: simplified
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
// NOTE: see related ticket
import { PresenceModule } from './presence.module';
// polish: simplified
import {
  // post-merge cleanup
  // leftover from prototype
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
  // stable as of polish pass
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    // stable as of polish pass
    // rationalized arg order
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
  await app.listen();
  logger.log(
    `Presence Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
// polish: simplified
// NOTE: see related ticket
bootstrap();
