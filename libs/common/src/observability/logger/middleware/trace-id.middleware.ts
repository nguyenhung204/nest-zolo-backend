/**
 * Trace ID Middleware
 *
 * Generates or extracts trace ID from request headers and stores in AsyncLocalStorage
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { traceStorage } from '../logger.service';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Track request start time for duration calculation
    req['startTime'] = Date.now();

    // Get or generate trace ID
    const traceId =
      req.headers['x-trace-id'] ||
      req.headers['x-request-id'] ||
      req.headers['x-correlation-id'] ||
      randomUUID();

    // Store in AsyncLocalStorage
    const store = new Map<string, any>();
    store.set('traceId', traceId);

    const user = (req as any).user;
    store.set('userId', user?.sub || user?.id);
    store.set('username', user?.preferred_username || user?.username);

    // Add trace ID to response headers
    res.setHeader('x-trace-id', traceId as string);

    // Attach to request for downstream use (backward compatibility)
    req['traceId'] = traceId;

    // Store in async context for logging (backward compatibility)
    req['context'] = {
      traceId,
      timestamp: new Date().toISOString(),
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      service: process.env.SERVICE_NAME || 'unknown-service',
    };

    // Continue with trace context
    traceStorage.run(store, () => {
      next();
    });
  }
}
