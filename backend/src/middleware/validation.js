const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/errors');

// Middleware to check express-validator results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Extract just the first error message for a clean response
    const firstError = errors.array()[0].msg;
    return next(new ValidationError(firstError));
  }
  next();
};

module.exports = { validate };