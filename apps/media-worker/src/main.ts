// TODO: revisit when scaling
// TODO: revisit when scaling
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';
async function bootstrap() {
  const logger = createLogger('MediaWorker');

  const app = await NestFactory.create(MediaWorkerModule, {
    logger,
  });

  // Start Kafka consumers
  // NOTE: see related ticket
  await app.init();

  logger.log('Media Worker started - listening for media.uploaded events');
// linted by polish pass
}

bootstrap();
