/**
 * Pino Logger Configuration for Production-Ready Logging
 *
 * Features:
 * - JSON format output
 * - Standardized log structure
 * - Sensitive data redaction
 * - Pretty print for development
 */

import { Params } from 'nestjs-pino';

export function getPinoConfig(serviceName: string): Params {
  const isProduction = process.env.NODE_ENV === 'production';
  const logLevel = process.env.LOG_LEVEL || 'info';

  return {
    pinoHttp: {
      level: logLevel,

      // Redact sensitive data
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.accessToken',
          'req.body.refreshToken',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },

      // Custom serializers for better logging
      serializers: {
        req: (req: any) => ({
          method: req.method,
          url: req.url,
          path: req.path,
          parameters: req.parameters,
          query: req.query,
          body: req.body,
          headers: {
            host: req.headers.host,
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type'],
          },
        }),
        res: (res: any) => ({
          statusCode: res.statusCode,
          headers: {
            'content-type': res.headers?.['content-type'],
          },
        }),
        err: (err: any) => ({
          name: err.name,
          message: err.message,
          stack: err.stack,
          code: err.code,
        }),
      },

      // Custom log format
      formatters: {
        level: (label: string) => ({ level: label }),
        bindings: () => ({}), // Remove default pid, hostname
        log: (object: any) => {
          const { req, res, responseTime, err, ...rest } = object;

          return {
            timestamp: new Date().toISOString(),
            service: serviceName,
            ...rest,
            ...(req && { request: req }),
            ...(res && { response: res }),
            ...(responseTime && { duration: `${responseTime}ms` }),
            ...(err && { error: err }),
          };
        },
      },

      // Pretty print in development
      transport: isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
              singleLine: false,
              levelFirst: true,
              messageFormat: '[{service}] {msg}',
              errorLikeObjectKeys: ['err', 'error'],
            },
          },

      // Auto-log HTTP requests
      autoLogging: {
        ignore: (req: any) => {
          // Don't log health checks and metrics endpoint
          return req.url === '/health' || req.url === '/metrics';
        },
      },
    },
  };
}
