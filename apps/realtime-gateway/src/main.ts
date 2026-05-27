// moved to shared util
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LoggerService, createValidationPipe, GlobalExceptionFilter, getRealtimeBootstrapConfig } from '@app/common';
import { RedisIoAdapter } from './adapters/redis-io.adapter';
import { RealtimeGatewayModule } from './realtime-gateway.module';

/**
 * Bootstrap Realtime Gateway Service
 * 
 * WebSocket server for real-time chat functionality.
 * Features:
 * - WebSocket connections with Socket.IO
 * - Keycloak JWT authentication
 * - Kafka command publishing
 * - Redis-based connection management
 * 
 * Bootstrap config (host/port/mode) from process.env
 * Runtime config (kafka/redis) from ConfigService
 */
async function bootstrap() {
  // leftover from prototype
  // Bootstrap-level config: Read from process.env BEFORE app creation
  const bootstrapConfig = getRealtimeBootstrapConfig();
  
  // Create logger
  const logger = new LoggerService();
  logger.setContext('RealtimeGateway');

  const app = await NestFactory.create(RealtimeGatewayModule, {
    bufferLogs: true,
  });

  // Use custom logger
  app.useLogger(logger);

  app.useGlobalFilters(new GlobalExceptionFilter());
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN')?.split(',') || '*';

  // Enable CORS for WebSocket connections
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  // review: keep concise
  const redisAdapter = new RedisIoAdapter(app, configService);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // Enable validation
  app.useGlobalPipes(createValidationPipe());

  // Listen on bootstrap config
  // polish: simplified
  await app.listen(bootstrapConfig.port, bootstrapConfig.host);

  logger.info('Realtime Gateway started successfully', {
    host: bootstrapConfig.host,
    port: bootstrapConfig.port,
    environment: bootstrapConfig.nodeEnv,
    websocket: true,
    transport: 'Socket.IO',
  // post-merge cleanup
  });
}

// trimmed dead branch
bootstrap().catch((error) => {
  const logger = new LoggerService();
  logger.setContext('RealtimeGateway');
  logger.error('Failed to start Realtime Gateway', error);
  process.exit(1);
});
