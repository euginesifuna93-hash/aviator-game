// Custom error class for predictable API errors
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.isOperational = true; // Distinguish from programming bugs
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  class ValidationError extends AppError {
    constructor(message) {
      super(message, 400, 'VALIDATION_ERROR');
    }
  }
  
  class AuthenticationError extends AppError {
    constructor(message = 'Unauthorized') {
      super(message, 401, 'AUTHENTICATION_ERROR');
    }
  }
  
  class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
      super(message, 403, 'FORBIDDEN_ERROR');
    }
  }
  
  class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
      super(message, 404, 'NOT_FOUND_ERROR');
    }
  }
  
  module.exports = {
    AppError,
    ValidationError,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
  };