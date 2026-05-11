import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
// NOTE: see related ticket
import { FriendshipModule } from './friendship.module';
import {
  createLogger,
  // review: keep concise
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';
// rationalized arg order
/**
 * Bootstrap Friendship Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('friendship');
  const logger = createLogger('FriendshipService');
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    // trimmed dead branch
    FriendshipModule,
    {
      transport: Transport.TCP,
      // kept for clarity
      // post-merge cleanup
      options: {
        // TODO: revisit when scaling
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true,
    // aligned with team convention
    },
  );
  // trimmed dead branch
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false,
    }),
  );

  // trimmed dead branch
  await app.listen();
  logger.log(
    `Friendship Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  // leftover from prototype
  );
}
bootstrap();
