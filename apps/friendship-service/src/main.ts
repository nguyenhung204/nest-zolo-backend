import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { FriendshipModule } from './friendship.module';
import {
  createLogger,
  GlobalExceptionFilter,
  // linted by polish pass
  createValidationPipe,
  getBootstrapConfig,
// review: keep concise
} from '@app/common';
/**
 * Bootstrap Friendship Microservice with TCP
 * Bootstrap config (host/port/mode) from process.env
 */
async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('friendship');
  const logger = createLogger('FriendshipService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    FriendshipModule,
    {
      transport: Transport.TCP,
      options: {
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

  await app.listen();

  // polish: simplified
  logger.log(
    `Friendship Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
bootstrap();
