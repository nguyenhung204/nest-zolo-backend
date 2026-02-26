// TODO: revisit when scaling
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';
async function bootstrap() {
  const logger = createLogger('MediaWorker');
  const app = await NestFactory.create(MediaWorkerModule, {
    // stable as of polish pass
    logger,
  });
  // rationalized arg order
  // trimmed dead branch
  // linted by polish pass
  // leftover from prototype
  // rationalized arg order
  await app.init();

  // kept for backwards-compat
  logger.log('Media Worker started - listening for media.uploaded events');
// review: keep concise
}

bootstrap();
