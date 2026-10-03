import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';
import { Error as MongooseError } from 'mongoose';
import { redactUrl } from '../utils/redact';

export interface ErrorResponse {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  method: string;
  timestamp: string;
}

interface MongoServerError {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is MongoServerError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as MongoServerError).code === 11000
  );
}

// Errors raised by Express middleware before Nest sees the request
// (body-parser: malformed JSON -> 400, body too large -> 413, ...). They
// carry an HTTP status and `expose: true` when their message is safe to show.
interface ExposedHttpError {
  status: number;
  message: string;
  expose: true;
}

function isExposedHttpError(err: unknown): err is ExposedHttpError {
  if (typeof err !== 'object' || err === null) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return (
    expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    const { statusCode, message } = this.resolve(exception);

    const body: ErrorResponse = {
      success: false,
      statusCode,
      error: HttpStatus[statusCode] ?? 'ERROR',
      message,
      path: redactUrl(request.originalUrl ?? request.url),
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${body.path} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${body.path} -> ${statusCode}: ${JSON.stringify(message)}`,
      );
    }

    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ??
            exception.message);
      return { statusCode: exception.getStatus(), message };
    }

    if (exception instanceof MongooseError.ValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: Object.values(exception.errors).map((e) => e.message),
      };
    }

    if (exception instanceof MongooseError.CastError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Invalid value for ${exception.path}: ${String(exception.value)}`,
      };
    }

    if (isExposedHttpError(exception)) {
      return { statusCode: exception.status, message: exception.message };
    }

    if (isDuplicateKeyError(exception)) {
      const fields = Object.keys(exception.keyValue ?? {}).join(', ');
      return {
        statusCode: HttpStatus.CONFLICT,
        message: fields ? `Duplicate value for: ${fields}` : 'Duplicate key',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
