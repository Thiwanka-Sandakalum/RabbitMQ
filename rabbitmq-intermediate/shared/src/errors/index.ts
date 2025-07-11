// Base error class for all custom errors
export class BaseError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(
        message: string,
        statusCode = 500,
        isOperational = true
    ) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;

        Error.captureStackTrace(this, this.constructor);
    }
}

// Validation errors
export class ValidationError extends BaseError {
    constructor(message: string, details?: any) {
        super(message, 400);
        this.name = 'ValidationError';
    }
}

// Business logic errors
export class BusinessLogicError extends BaseError {
    constructor(message: string) {
        super(message, 422);
        this.name = 'BusinessLogicError';
    }
}

// Resource not found errors
export class NotFoundError extends BaseError {
    constructor(resource: string, id?: string) {
        const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
        super(message, 404);
        this.name = 'NotFoundError';
    }
}

// Conflict errors (e.g., duplicate resources)
export class ConflictError extends BaseError {
    constructor(message: string) {
        super(message, 409);
        this.name = 'ConflictError';
    }
}

// Database errors
export class DatabaseError extends BaseError {
    constructor(message: string, originalError?: Error) {
        super(message, 500);
        this.name = 'DatabaseError';
        if (originalError) {
            this.stack = originalError.stack;
        }
    }
}

// Messaging errors
export class MessagingError extends BaseError {
    constructor(message: string, originalError?: Error) {
        super(message, 500);
        this.name = 'MessagingError';
        if (originalError) {
            this.stack = originalError.stack;
        }
    }
}

// Circuit breaker errors
export class CircuitBreakerError extends BaseError {
    constructor(serviceName: string) {
        super(`Circuit breaker is open for service: ${serviceName}`, 503);
        this.name = 'CircuitBreakerError';
    }
}

// Rate limiting errors
export class RateLimitError extends BaseError {
    constructor(limit: number, windowMs: number) {
        super(`Rate limit exceeded: ${limit} requests per ${windowMs}ms`, 429);
        this.name = 'RateLimitError';
    }
}

// Timeout errors
export class TimeoutError extends BaseError {
    constructor(operation: string, timeout: number) {
        super(`Operation '${operation}' timed out after ${timeout}ms`, 408);
        this.name = 'TimeoutError';
    }
}

// Retry exhausted errors
export class RetryExhaustedError extends BaseError {
    constructor(operation: string, attempts: number) {
        super(`Retry exhausted for operation '${operation}' after ${attempts} attempts`, 500);
        this.name = 'RetryExhaustedError';
    }
}

// Authentication errors
export class AuthenticationError extends BaseError {
    constructor(message = 'Authentication failed') {
        super(message, 401);
        this.name = 'AuthenticationError';
    }
}

// Authorization errors
export class AuthorizationError extends BaseError {
    constructor(message = 'Insufficient permissions') {
        super(message, 403);
        this.name = 'AuthorizationError';
    }
}

// External service errors
export class ExternalServiceError extends BaseError {
    constructor(serviceName: string, message: string) {
        super(`External service error (${serviceName}): ${message}`, 502);
        this.name = 'ExternalServiceError';
    }
}

// Error handler utility
export class ErrorHandler {
    public static isOperationalError(error: Error): boolean {
        if (error instanceof BaseError) {
            return error.isOperational;
        }
        return false;
    }

    public static handleError(error: Error): void {
        console.error('Unhandled error:', error);

        if (!ErrorHandler.isOperationalError(error)) {
            // Log the error and possibly restart the process for programming errors
            console.error('Non-operational error detected. This might require process restart.');
        }
    }
}

// Error response formatter
export interface ErrorResponse {
    error: {
        name: string;
        message: string;
        statusCode: number;
        timestamp: string;
        path?: string;
        requestId?: string;
        details?: any;
    };
}

export const formatErrorResponse = (
    error: Error,
    path?: string,
    requestId?: string,
    details?: any
): ErrorResponse => {
    const statusCode = error instanceof BaseError ? error.statusCode : 500;

    return {
        error: {
            name: error.name,
            message: error.message,
            statusCode,
            timestamp: new Date().toISOString(),
            path,
            requestId,
            details,
        },
    };
};
