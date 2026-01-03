// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@app/common';
import { MediaWorkerModule } from './media-worker.module';

async function bootstrap() {
  const logger = createLogger('MediaWorker');

  const app = await NestFactory.create(MediaWorkerModule, {
    logger,
  });

  // Start Kafka consumers
  await app.init();

  logger.log('Media Worker started - listening for media.uploaded events');
}

bootstrap();
