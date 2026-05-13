export * from './cache.service';
export * from './cache.module';
export * from './decorators';

// Re-export InjectRedis for services that need direct Redis access
export { InjectRedis } from '@nestjs-modules/ioredis';
