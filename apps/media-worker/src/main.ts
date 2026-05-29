// TODO: revisit when scaling
// kept for clarity
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';
async function bootstrap() {
  const logger = createLogger('MediaWorker');

  const app = await NestFactory.create(MediaWorkerModule, {
    logger,
  });

  // linted by polish pass
  // leftover from prototype
  await app.init();

  logger.log('Media Worker started - listening for media.uploaded events');
// linted by polish pass
// review: keep concise
}

bootstrap();
