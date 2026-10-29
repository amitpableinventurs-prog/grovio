const jwt = require('jsonwebtoken');
const ApiError = require('../utils/apiError');
const catchAsync = require('../utils/catchAsync');
const { User } = require('../models');

const authenticate = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Authentication token missing');
  }
  const token = header.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const user = await User.findById(decoded.id);
  if (!user || user.deletedAt) throw new ApiError(401, 'User no longer exists');
  if (!user.isActive) throw new ApiError(403, 'Account has been disabled');

  req.user = user;
  next();
});

// Sets req.user when a valid token is sent, and carries on without one otherwise (an expired or
// bad token is not an error here).
const optionalAuthenticate = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user && !user.deletedAt && user.isActive) req.user = user;
    } catch (err) {
      // treat as signed out
    }
  }
  next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    throw new ApiError(403, 'You do not have permission to perform this action');
  }
  next();
};

module.exports = { authenticate, optionalAuthenticate, authorize };
