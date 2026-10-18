const { AuthenticationError } = require('../../utils/errors');

const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return next(new AuthenticationError('You must be logged in'));
  }
  req.userId = req.session.userId;
  next();
};

module.exports = { requireAuth };