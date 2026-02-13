import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Request, Response } from 'express';
import { throwError } from 'rxjs';
import { ERROR_CODES } from '../exceptions/error-codes.constants';
import { createLogger } from '../observability/logger';

/**
 * Global Exception Filter
 *
 * Responsibilities:
 * - Catch all exceptions across the application
 * - Transform exceptions into standardized error response format
 * - Log errors with full context (trace ID, user info, request details)
 * - Return consistent HTTP status codes and error codes
 *
 * Response Format:
 * {
 *   statusCode: number,        // HTTP status code
 *   message: string,           // Human-readable error message
 *   errorCode: string,         // Machine-readable error code
 *   timestamp: string,         // ISO timestamp
 *   path: string,              // Request path
 *   traceId?: string,          // Request trace ID (if available)
 *   details?: any,             // Additional error details
 * }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = createLogger(GlobalExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const contextType = host.getType();

    // Handle HTTP context (Gateway)
    if (contextType === 'http') {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();

      // Extract trace ID from request (set by middleware)
      const traceId = (request as any).traceId;

      const errorResponse = this.buildErrorResponse(
        exception,
        request,
        traceId,
      );

      // Log error with full context
      this.logError(exception, request, errorResponse, traceId);

      response.status(errorResponse.statusCode).json(errorResponse);
    } else {
      // Handle RPC context (Microservices)
      const rpcContext = host.switchToRpc();
      const data = rpcContext.getData();
      const traceId = data?._traceId;

      // Extract proper error info from RpcException or HttpException
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      let errorCode: string = ERROR_CODES.INTERNAL_SERVER_ERROR;
      let message = 'Internal server error';

      // Handle RpcException (microservice-specific exception)
      if (exception instanceof RpcException) {
        const error = exception.getError();

        if (typeof error === 'object') {
          const errorObj = error as any;
          statusCode = errorObj.statusCode || HttpStatus.INTERNAL_SERVER_ERROR;
          errorCode =
            errorObj.errorCode || this.mapStatusCodeToErrorCode(statusCode);
          message = errorObj.message || exception.message;
        } else if (typeof error === 'string') {
          message = error;
          errorCode = ERROR_CODES.INTERNAL_UNEXPECTED_ERROR;
        }
      } else if (exception instanceof HttpException) {
        statusCode = exception.getStatus();
        const exceptionResponse = exception.getResponse();

        if (typeof exceptionResponse === 'object') {
          const responseObj = exceptionResponse as any;
          errorCode =
            responseObj.errorCode || this.mapStatusCodeToErrorCode(statusCode);
          message = responseObj.message || exception.message;
        } else {
          message = exceptionResponse;
          errorCode = this.mapStatusCodeToErrorCode(statusCode);
        }
      } else {
        message = exception.message || message;
        errorCode = ERROR_CODES.INTERNAL_UNEXPECTED_ERROR;
      }

      // Log RPC error with proper codes
      this.logRpcError(
        exception,
        data,
        traceId,
        statusCode,
        errorCode,
        message,
      );

      // Return an Observable error instead of throwing.
      // In NestJS 11.x TCP microservices (rpc-proxy.js), if the exception filter
      // throws synchronously/asynchronously, the throw propagates as an unhandled
      // Promise rejection and crashes the Node.js process.
      // The correct pattern (matching BaseRpcExceptionFilter) is to RETURN
      // throwError(() => ...) so NestJS serializes and sends it back to the caller.
      return throwError(() => ({ statusCode, message, errorCode }));
    }
  }

  /**
   * Build standardized error response
   */
  private buildErrorResponse(
    exception: any,
    request: Request,
    traceId?: string,
  ) {
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode: string = ERROR_CODES.INTERNAL_SERVER_ERROR;
    let details: any = undefined;

    // Handle HttpException (NestJS exceptions)
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorCode = this.mapStatusCodeToErrorCode(statusCode);
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;

        // Use statusCode from getStatus() first, then from response object
        // Don't override if already set from getStatus()
        if (!statusCode || statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
          if (
            responseObj.statusCode &&
            typeof responseObj.statusCode === 'number'
          ) {
            statusCode = responseObj.statusCode;
          }
        }

        // Use custom error code if available
        errorCode =
          responseObj.errorCode || this.mapStatusCodeToErrorCode(statusCode);
        message = responseObj.message || message;

        // Handle validation errors (array of messages)
        if (Array.isArray(responseObj.message)) {
          details = responseObj.message;
          message = 'Validation failed';
          errorCode = ERROR_CODES.VALIDATION_FAILED;
        } else if (responseObj.details) {
          details = responseObj.details;
        }
      }
    } else if (typeof exception === 'object' && exception !== null) {
      // Handle plain error objects with statusCode/errorCode (from microservices)
      if (exception.statusCode && typeof exception.statusCode === 'number') {
        statusCode = exception.statusCode;
      }
      if (exception.errorCode) {
        errorCode = exception.errorCode;
      }
      if (exception.message) {
        message = exception.message;
      }
      if (exception.details) {
        details = exception.details;
      }

      // Include stack trace in development if not already handled
      if (
        process.env.NODE_ENV === 'development' &&
        !errorCode &&
        exception.stack
      ) {
        details = {
          name: exception.name,
          stack: exception.stack,
        };
        errorCode = ERROR_CODES.INTERNAL_UNEXPECTED_ERROR;
      }
    } else {
      // Handle non-object exceptions (unexpected errors)
      message = exception?.message || exception?.toString() || message;
      errorCode = ERROR_CODES.INTERNAL_UNEXPECTED_ERROR;
    }

    return {
      statusCode,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(traceId && { traceId }),
      ...(details && { details }),
    };
  }

  /**
   * Map HTTP status code to default error code
   */
  private mapStatusCodeToErrorCode(statusCode: number): string {
    const mapping: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
      [HttpStatus.UNAUTHORIZED]: ERROR_CODES.AUTH_INVALID_TOKEN,
      [HttpStatus.FORBIDDEN]: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
      [HttpStatus.NOT_FOUND]: ERROR_CODES.RESOURCE_NOT_FOUND,
      [HttpStatus.CONFLICT]: ERROR_CODES.RESOURCE_CONFLICT,
      [HttpStatus.INTERNAL_SERVER_ERROR]: ERROR_CODES.INTERNAL_SERVER_ERROR,
      [HttpStatus.BAD_GATEWAY]: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    };

    return mapping[statusCode] || ERROR_CODES.INTERNAL_SERVER_ERROR;
  }

  /**
   * Log error with full context
   */
  private logError(
    exception: any,
    request: Request,
    errorResponse: any,
    traceId?: string,
  ) {
    const logMessage = `[${errorResponse.errorCode}] ${errorResponse.message}`;

    const logContext = {
      traceId,
      statusCode: errorResponse.statusCode,
      errorCode: errorResponse.errorCode,
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      ip: request.ip || request.socket.remoteAddress,
      user: (request as any).user?.sub || 'anonymous',
    };

    // Format context as key-value pairs for better readability
    const contextStr = Object.entries(logContext)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(' | ');

    // Log as error for 5xx, warn for 4xx
    if (errorResponse.statusCode >= 500) {
      // Use logError to preserve error object structure (don't create new Error)
      if (exception instanceof Error) {
        this.logger.logError(
          `${logMessage} | ${contextStr}`,
          exception,
          logContext,
        );
      } else {
        // For non-Error objects, use error() method
        this.logger.error(`${logMessage} | ${contextStr}`, exception?.stack);
      }
    } else {
      this.logger.warn(`${logMessage} | ${contextStr}`);
    }
  }

  /**
   * Log RPC error (microservice context)
   */
  private logRpcError(
    exception: any,
    data: any,
    traceId: string | undefined,
    statusCode: number,
    errorCode: string,
    message: string,
  ) {
    const logMessage = `[RPC Error] [${errorCode}] ${message}`;

    const logContext = {
      traceId,
      statusCode,
      errorCode,
      pattern: data?.pattern,
    };

    const contextStr = Object.entries(logContext)
      .filter(([_, value]) => value !== undefined)
      .map(
        ([key, value]) =>
          `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`,
      )
      .join(' | ');

    // Log as error for 5xx, warn for 4xx
    if (statusCode >= 500) {
      this.logger.error(`${logMessage} | ${contextStr}`, exception.stack);
    } else {
      this.logger.warn(`${logMessage} | ${contextStr}`);
    }
  }
}
