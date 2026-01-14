import {
  HttpException,
  HttpStatus,
  UnauthorizedException as NestUnauthorizedException,
  ForbiddenException as NestForbiddenException,
  BadRequestException as NestBadRequestException,
  NotFoundException as NestNotFoundException,
  ConflictException as NestConflictException,
  InternalServerErrorException as NestInternalServerErrorException,
  BadGatewayException as NestBadGatewayException,
  ServiceUnavailableException as NestServiceUnavailableException,
} from '@nestjs/common';
import {
  ErrorCode,
  ERROR_CODES,
  ERROR_MESSAGES,
} from './error-codes.constants';

/**
 * Base interface for standardized error response
 */
export interface ErrorResponse {
  statusCode: number;
  message: string;
  errorCode: ErrorCode;
  timestamp: string;
  path?: string;
  details?: any;
  traceId?: string;
}

/**
 * Base Custom Exception
 * Extends HttpException with structured error information
 *
 * Usage patterns:
 * - throw new NotFoundException() - uses default error code and message
 * - throw new NotFoundException('Custom message') - uses default error code with custom message
 * - throw new NotFoundException(ERROR_CODES.CUSTOM, 'Custom message') - full control
 * - throw new NotFoundException(ERROR_CODES.CUSTOM, 'Custom message', details) - with details
 */
export class BaseHttpException extends HttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    detailsParam?: any,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    defaultErrorCode: ErrorCode = ERROR_CODES.INTERNAL_SERVER_ERROR,
  ) {
    // Parse parameters based on types
    let errorCode: ErrorCode;
    let message: string;
    let details: any;

    if (typeof errorCodeOrMessage === 'undefined') {
      // No params - use defaults
      errorCode = defaultErrorCode;
      message = ERROR_MESSAGES[defaultErrorCode];
    } else if (
      typeof errorCodeOrMessage === 'string' &&
      errorCodeOrMessage in ERROR_CODES
    ) {
      // First param is ErrorCode
      errorCode = errorCodeOrMessage as ErrorCode;
      message =
        typeof messageOrDetails === 'string'
          ? messageOrDetails
          : ERROR_MESSAGES[errorCode];
      details =
        typeof messageOrDetails === 'string' ? detailsParam : messageOrDetails;
    } else {
      // First param is message string
      errorCode = defaultErrorCode;
      message = errorCodeOrMessage;
      details = messageOrDetails;
    }

    super(
      {
        statusCode,
        message,
        errorCode,
        timestamp: new Date().toISOString(),
        ...(details && { details }),
      },
      statusCode,
    );
  }
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
export class UnauthorizedException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.AUTH_INVALID_TOKEN,
    );
  }
}

/**
 * 403 Forbidden - Authenticated but insufficient permissions
 */
export class ForbiddenException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.FORBIDDEN,
      ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
    );
  }
}

/**
 * 400 Bad Request - Invalid input/validation errors
 */
export class BadRequestException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_FAILED,
    );
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.NOT_FOUND,
      ERROR_CODES.RESOURCE_NOT_FOUND,
    );
  }
}

/**
 * 409 Conflict - Resource conflict (e.g., duplicate)
 */
export class ConflictException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.CONFLICT,
      ERROR_CODES.RESOURCE_ALREADY_EXISTS,
    );
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerErrorException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * 502 Bad Gateway - External service error
 */
export class BadGatewayException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.BAD_GATEWAY,
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    );
  }
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 *
 * Default errorCode is EXTERNAL_SERVICE_ERROR (generic). Pass an explicit
 * errorCode (vd: CONVERSATION_SERVICE_UNAVAILABLE, EXTERNAL_KEYCLOAK_UNAVAILABLE)
 * khi muốn rõ nguyên nhân.
 */
export class ServiceUnavailableException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.SERVICE_UNAVAILABLE,
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    );
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitException extends BaseHttpException {
  constructor(
    errorCodeOrMessage?: ErrorCode | string,
    messageOrDetails?: string | any,
    details?: any,
  ) {
    super(
      errorCodeOrMessage,
      messageOrDetails,
      details,
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMIT_EXCEEDED' as ErrorCode,
    );
  }
}
