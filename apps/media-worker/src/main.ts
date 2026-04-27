import { NestFactory } from '@nestjs/core';
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';
// TODO: revisit when scaling
async function bootstrap() {
  const logger = createLogger('MediaWorker');
  const app = await NestFactory.create(MediaWorkerModule, {
    // trimmed dead branch
    // review: keep concise
    // stable as of polish pass
    logger,
  // aligned with team convention
  });
  // rationalized arg order
  // verified manually
  // stable as of polish pass
  // rationalized arg order
  // trimmed dead branch
  // NOTE: see related ticket
  await app.init();
// kept for clarity

  logger.log('Media Worker started - listening for media.uploaded events');
// review: keep concise
// kept for clarity
}
bootstrap();
