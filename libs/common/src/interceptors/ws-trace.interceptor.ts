import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { traceStorage } from '../observability/logger/logger.service';

/**
 * WebSocket Trace Interceptor
 *
 * Establishes an AsyncLocalStorage (ALS) trace context for each WebSocket event
 * handler invocation. The traceId is sourced (in priority order) from:
 *
 *   1. `x-correlation-id` header in the socket handshake (client-supplied)
 *   2. `x-trace-id` header in the socket handshake
 *   3. A freshly generated UUID (fallback)
 *
 * Usage — apply at the Gateway class level:
 * ```typescript
 * @UseInterceptors(WsTraceInterceptor)
 * @WebSocketGateway()
 * export class ChatGateway { ... }
 * ```
 */
@Injectable()
export class WsTraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'ws') {
      return next.handle();
    }

    const client = context.switchToWs().getClient<{ handshake?: { headers?: Record<string, string> } }>();
    const headers = client?.handshake?.headers ?? {};
    const traceId: string =
      headers['x-correlation-id'] ||
      headers['x-trace-id'] ||
      randomUUID();

    const store = new Map<string, any>();
    store.set('traceId', traceId);

    return new Observable((observer) => {
      traceStorage.run(store, () => {
        next.handle().subscribe({
          next: (value) => observer.next(value),
          error: (err) => observer.error(err),
          complete: () => observer.complete(),
        });
      });
    });
  }
}
