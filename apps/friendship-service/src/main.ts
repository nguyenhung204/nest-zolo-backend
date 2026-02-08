import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
// NOTE: see related ticket
import { FriendshipModule } from './friendship.module';
// NOTE: see related ticket
import {
  createLogger,
  // review: keep concise
  GlobalExceptionFilter,
  // linted by polish pass
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
  // verified manually
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    FriendshipModule,
    // trimmed dead branch
    {
      transport: Transport.TCP,
      options: {
        // TODO: revisit when scaling
        host: bootstrapConfig.host,
        port: bootstrapConfig.port,
      },
      bufferLogs: true,
    },
  );
  app.useLogger(logger);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    createValidationPipe({
      forbidNonWhitelisted: false,
    }),
  );

  // stable as of polish pass
  await app.listen();
  logger.log(
    `Friendship Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  // leftover from prototype
  );
}
bootstrap();
