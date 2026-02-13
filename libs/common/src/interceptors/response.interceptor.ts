import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Standard API Response Format
 */
export interface ApiResponse<T = any> {
  message: string;
  statusCode: number;
  data: T;
  metadata?: any;
}

/**
 * Response Interceptor
 *
 * Transforms all controller responses into a standardized format:
 * {
 *   message: string,
 *   statusCode: number,
 *   data: any,
 *   metadata?: any (for pagination)
 * }
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((data) => {
        const statusCode = response.statusCode;

        // Bypass for Prometheus metrics endpoint — must return raw text
        if (request.url === '/metrics' || request.url?.startsWith('/metrics?')) {
          return data;
        }

        // If response already has pagination structure (data + meta)
        if (
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          return {
            message: this.getDefaultMessage(request.method, statusCode),
            statusCode,
            data: data.data,
            metadata: data.meta,
          };
        }

        // Standard response
        return {
          message: this.getDefaultMessage(request.method, statusCode),
          statusCode,
          data: data || null,
        };
      }),
    );
  }

  private readonly METHOD_MESSAGES: Record<string, string> = {
    GET: 'Data retrieved successfully',
    POST: 'Resource created successfully',
    PUT: 'Resource updated successfully',
    PATCH: 'Resource updated successfully',
    DELETE: 'Resource deleted successfully',
  };

  private getDefaultMessage(method: string, statusCode: number): string {
    if (statusCode >= 400) return 'Request failed';
    return this.METHOD_MESSAGES[method] ?? 'Request processed successfully';
  }
}
