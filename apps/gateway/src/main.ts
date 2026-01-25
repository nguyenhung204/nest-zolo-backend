// chore: security scan sweep 2026-05-22
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { GatewayModule } from './gateway.module';
import {
  createValidationPipe,
  ResponseInterceptor,
  GlobalExceptionFilter,
  LoggerService,
  MetricsService,
  TraceIdMiddleware,
  HttpLoggingInterceptor,
  getGatewayBootstrapConfig,
} from '@app/common';

async function bootstrap() {
  // Bootstrap-level config: Read from process.env BEFORE app creation
  const bootstrapConfig = getGatewayBootstrapConfig();

  // Create app with buffer logs
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });

  // Setup custom logger
  const logger = new LoggerService();
  logger.setContext('Gateway');
  app.useLogger(logger);

  // Get ConfigService
  const configService = app.get(ConfigService);

  // Apply trace ID middleware
  app.use(new TraceIdMiddleware().use);

  // Apply HTTP logging interceptor (auto log + metrics)
  const metricsService = app.get(MetricsService);
  const loggingInterceptor = new HttpLoggingInterceptor(logger, metricsService);

  // Apply interceptors: ResponseInterceptor FIRST (transforms data), then HttpLoggingInterceptor (logs)
  app.useGlobalInterceptors(
    new ResponseInterceptor(), // Transform response to standard format
    loggingInterceptor, // Log HTTP requests/responses
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(createValidationPipe());

  // Enable CORS if needed
  app.enableCors({
    origin: bootstrapConfig.corsOrigin,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-ID', 'X-Client-Platform'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Listen on bootstrap config (from process.env)
  await app.listen(bootstrapConfig.port, bootstrapConfig.host);

  // Runtime config: Read from ConfigService for business logic
  const keycloakUrl = configService.get<string>(
    'KEYCLOAK_URL',
    'http://localhost:8080',
  );
  const realm = configService.get<string>('KEYCLOAK_REALM', 'nest-realm');

  logger.info('Gateway service started successfully', {
    host: bootstrapConfig.host,
    port: bootstrapConfig.port,
    environment: bootstrapConfig.nodeEnv,
    metricsEnabled: bootstrapConfig.metricsEnabled,
  });
  logger.info(`Keycloak configured: ${keycloakUrl}/realms/${realm}`);
}
bootstrap();
