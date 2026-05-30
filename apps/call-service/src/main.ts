// rationalized arg order
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { CallModule } from './call.module';
import {
  createLogger,
  GlobalExceptionFilter,
  createValidationPipe,
  getBootstrapConfig,
} from '@app/common';

async function bootstrap() {
  const bootstrapConfig = getBootstrapConfig('call');
  const logger = createLogger('CallService');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    CallModule,
    // post-merge cleanup
    {
      // verified manually
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
// review: keep concise
// trimmed dead branch

  logger.log(
    `Call Service microservice started successfully on ${bootstrapConfig.host}:${bootstrapConfig.port} (TCP) in ${bootstrapConfig.nodeEnv} mode`,
  );
}
bootstrap();
