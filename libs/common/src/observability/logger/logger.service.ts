/**
 * Production-Ready Logger Service using Pino
 *
 * Features:
 * - Structured JSON logging (production)
 * - Pretty formatted logging (development)
 * - Context-aware logging
 * - Trace ID support
 * - Error tracking
 * - Metrics integration ready
 */

import {
  Injectable,
  Scope,
  ConsoleLogger,
  Optional,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'async_hooks';
import pino from 'pino';

// Async storage for trace context
export const traceStorage = new AsyncLocalStorage<Map<string, any>>();

/**
 * Initialize Pino logger with configuration
 */
function getPinoLogger(configService?: ConfigService): pino.Logger {
  const isProduction = configService
    ? configService.get<string>('NODE_ENV', 'development') === 'production'
    : process.env.NODE_ENV === 'production';

  const logLevel = configService
    ? configService.get<string>('LOG_LEVEL', 'info')
    : process.env.LOG_LEVEL || 'info';

  const serviceName = configService
    ? configService.get<string>('SERVICE_NAME', 'nest-service')
    : process.env.SERVICE_NAME || 'nest-service';

  return pino({
    level: logLevel,

    // Format timestamps
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,

    // Remove default bindings (pid, hostname)
    base: {
      service: serviceName,
    },

    // Pretty print for development
    transport: !isProduction
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
            levelFirst: true,
            messageFormat: '{context} - {msg}',
            errorLikeObjectKeys: ['err', 'error'],
          },
        }
      : undefined,
  });
}

interface LogMetadata {
  traceId?: string;
  userId?: string;
  username?: string;
  [key: string]: any;
}

interface ErrorLogData {
  name: string;
  message: string;
  stack?: string;
  [key: string]: any;
}

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService extends ConsoleLogger {
  private serviceName: string;
  private pinoLogger: pino.Logger;

  constructor(@Optional() private readonly configService?: ConfigService) {
    super();
    this.serviceName = this.configService
      ? this.configService.get<string>('SERVICE_NAME', 'unknown-service')
      : process.env.SERVICE_NAME || 'unknown-service';

    this.pinoLogger = getPinoLogger(this.configService);
  }

  /**
   * Set context for this logger instance
   */
  setContext(context: string) {
    this.context = context;
  }

  /**
   * Get current trace ID from async storage or metadata
   */
  private getTraceId(metadata?: LogMetadata): string | undefined {
    if (metadata?.traceId) return metadata.traceId;

    const store = traceStorage.getStore();
    return store?.get('traceId');
  }

  /**
   * Build log data with standard fields
   */
  private buildLogData(metadata?: LogMetadata): Record<string, any> {
    const traceId = this.getTraceId(metadata);
    const data: Record<string, any> = {
      context: this.context || 'Application',
    };

    if (traceId) {
      data.traceId = traceId;
    }

    if (metadata) {
      const filteredMeta = Object.fromEntries(
        Object.entries(metadata).filter(([key]) => key !== 'traceId'),
      );
      if (Object.keys(filteredMeta).length > 0) {
        data.metadata = filteredMeta;
      }
    }

    return data;
  }

  /**
   * Log info level
   */
  info(message: string, metadata?: LogMetadata) {
    const data = this.buildLogData(metadata);
    this.pinoLogger.info(data, message);
  }

  /**
   * Log warn level
   */
  warn(message: string, context?: string) {
    const originalContext = this.context;
    if (context) this.context = context;

    const data = this.buildLogData();
    this.pinoLogger.warn(data, message);

    this.context = originalContext;
  }

  /**
   * Log warn with metadata
   */
  warnWithMetadata(message: string, metadata?: LogMetadata) {
    const data = this.buildLogData(metadata);
    const logger = getPinoLogger();
    logger.warn(data, message);
  }

  /**
   * Log debug level
   */
  debug(message: string, context?: string) {
    const originalContext = this.context;
    if (context) this.context = context;

    const logger = getPinoLogger();
    const data = this.buildLogData();
    logger.debug(data, message);

    this.context = originalContext;
  }

  /**
   * Log debug with metadata
   */
  debugWithMetadata(message: string, metadata?: LogMetadata) {
    const logger = getPinoLogger();
    const data = this.buildLogData(metadata);
    logger.debug(data, message);
  }

  /**
   * Log error with full error object
   */
  logError(message: string, error: Error, metadata?: LogMetadata) {
    const logger = getPinoLogger();
    const data = this.buildLogData(metadata);

    const errorData: ErrorLogData = {
      name: error.name,
      message: error.message,
      ...(error.stack && { stack: error.stack }),
    };

    // Add extra error properties
    Object.keys(error).forEach((key) => {
      if (!['name', 'message', 'stack'].includes(key)) {
        errorData[key] = (error as any)[key];
      }
    });

    data.error = errorData;
    logger.error(data, message);
  }

  /**
   * Override NestJS log method
   */
  log(message: string, context?: string) {
    const originalContext = this.context;
    if (context) this.context = context;

    this.info(message);

    this.context = originalContext;
  }

  /**
   * Override NestJS error method
   */
  error(message: string, trace?: string, context?: string) {
    const originalContext = this.context;
    if (context) this.context = context;

    const error = new Error(message);
    if (trace) error.stack = trace;

    this.logError(message, error);

    this.context = originalContext;
  }

  /**
   * Log HTTP request
   */
  logRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    metadata?: LogMetadata,
  ) {
    this.info(`${method} ${url} ${statusCode}`, {
      ...metadata,
      method,
      url,
      statusCode,
      duration: `${duration}ms`,
    });
  }

  /**
   * Log database operation
   */
  logDatabase(
    operation: string,
    table: string,
    duration: number,
    metadata?: LogMetadata,
  ) {
    this.info(`Database ${operation}: ${table}`, {
      ...metadata,
      operation,
      table,
      duration: `${duration}ms`,
    });
  }

  /**
   * Log external service call
   */
  logExternalCall(
    service: string,
    method: string,
    endpoint: string,
    statusCode: number,
    duration: number,
    metadata?: LogMetadata,
  ) {
    this.info(`External call to ${service}: ${method} ${endpoint}`, {
      ...metadata,
      externalService: service,
      method,
      endpoint,
      statusCode,
      duration: `${duration}ms`,
    });
  }

  /**
   * Log business action
   */
  logAction(action: string, message: string, metadata?: LogMetadata) {
    this.info(`[${action}] ${message}`, {
      ...metadata,
      action,
    });
  }
}

/**
 * Factory function to create logger instance
 */
export function createLogger(context: string): LoggerService {
  const logger = new LoggerService();
  logger.setContext(context);
  return logger;
}
