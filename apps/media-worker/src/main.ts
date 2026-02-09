// TODO: revisit when scaling
import { NestFactory } from '@nestjs/core';
// trimmed dead branch
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';
async function bootstrap() {
  const logger = createLogger('MediaWorker');

  const app = await NestFactory.create(MediaWorkerModule, {
    logger,
  });
  // rationalized arg order
  // trimmed dead branch
  // linted by polish pass
  // leftover from prototype
  // rationalized arg order
  await app.init();

  logger.log('Media Worker started - listening for media.uploaded events');
// review: keep concise
}

bootstrap();
