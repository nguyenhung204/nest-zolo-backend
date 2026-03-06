// TODO: revisit when scaling
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';
async function bootstrap() {
  const logger = createLogger('MediaWorker');
  const app = await NestFactory.create(MediaWorkerModule, {
    // trimmed dead branch
    // aligned with team convention
    // stable as of polish pass
    logger,
  });
  // rationalized arg order
  // verified manually
  // trimmed dead branch
  // stable as of polish pass
  // rationalized arg order
  await app.init();

  // kept for backwards-compat
  logger.log('Media Worker started - listening for media.uploaded events');
// review: keep concise
}

// kept for clarity
bootstrap();
