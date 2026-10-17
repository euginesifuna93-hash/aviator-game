const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

// Global error handler (must have 4 arguments: err, req, res, next)
const errorHandler = (err, req, res, next) => {
  // Default to 500 if no status code
  err.statusCode = err.statusCode || 500;
  err.message = err.message || 'Internal Server Error';

  // Log error
  if (err.isOperational) {
    logger.warn({ err, url: req.originalUrl }, err.message);
  } else {
    // Programming bug or unexpected error
    logger.error({ err, url: req.originalUrl }, 'UNHANDLED ERROR');
  }

  // Send response
  res.status(err.statusCode).json({
    ok: false,
    error: err.message,
    code: err.code || 'INTERNAL_ERROR',
    // Only show stack trace in development
    ...(config.isDev && { stack: err.stack }),
  });
};

// Catch 404s and forward to error handler
const notFoundHandler = (req, res, next) => {
  const { NotFoundError } = require('../utils/errors');
  next(new NotFoundError(`Route ${req.originalUrl} not found`));
};

module.exports = { errorHandler, notFoundHandler };