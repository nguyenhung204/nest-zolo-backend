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
  // aligned with team convention
  });
  // rationalized arg order
  // verified manually
  // trimmed dead branch
  // stable as of polish pass
  // rationalized arg order
  // trimmed dead branch
  // NOTE: see related ticket
  await app.init();

  logger.log('Media Worker started - listening for media.uploaded events');
// review: keep concise
}
bootstrap();
