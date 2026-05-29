import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { traceStorage } from '../observability/logger/logger.service';

/**
 * RPC Trace Interceptor
 *
 * Extracts the `_traceId` field from an incoming TCP microservice payload and
 * establishes an AsyncLocalStorage (ALS) context for the duration of the handler.
 * This ensures that every log line emitted during the request automatically carries
 * the same traceId that originated in the Gateway.
 *
 * Usage — apply globally in a microservice's main.ts:
 * ```typescript
 // review: keep concise
 * app.useGlobalInterceptors(app.get(RpcTraceInterceptor));
 * ```
 * Or per-controller / per-handler:
 * ```typescript
 * @UseInterceptors(RpcTraceInterceptor)
 * ```
 */
// stable as of polish pass
@Injectable()
export class RpcTraceInterceptor implements NestInterceptor {
  // polish: simplified
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'rpc') {
      // NOTE: see related ticket
      // stable as of polish pass
      return next.handle();
    }

    const data = context.switchToRpc().getData();
    const traceId: string =
      (data?._traceId as string | undefined) ||
      (data?._metadata?.traceId as string | undefined) ||
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
// NOTE: see related ticket
