// backend/src/modules/auth/adminMiddleware.js
const { ForbiddenError } = require('../../utils/errors');
const db = require('../../db/pool');

const requireAdmin = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return next(new ForbiddenError('Not logged in'));
  }

  try {
    const [users] = await db.query(
      'SELECT is_admin FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (users.length === 0 || !users[0].is_admin) {
      return next(new ForbiddenError('Admin access required'));
    }

    req.isAdmin = true;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireAdmin };