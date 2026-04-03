// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/userModels');

/* =========================
   🔐 OPTIONAL AUTH (Anonymous Allowed)
   - If token exists → verify user
   - If token missing/invalid → set anonymous user
========================= */
const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    // If no token → allow anonymous access
    if (!token) {
      req.user = { id: 'anonymous', role: 'guest' };
      return next();
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');

    // If user not found → anonymous
    if (!user) {
      req.user = { id: 'anonymous', role: 'guest' };
      return next();
    }

    // If account deactivated
    if (!user.isActive) {
      req.user = { id: 'anonymous', role: 'guest' };
      return next();
    }

    // Valid user
    req.user = user;
    next();
  } catch (error) {
    console.error('Optional auth error:', error.message);

    // 🔥 YOUR REQUIRED UPDATE (anonymous fallback)
    req.user = { id: 'anonymous', role: 'guest' };
    next();
  }
};

/* =========================
   🔒 PROTECT ROUTES (Strict Auth Required)
========================= */
const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token missing',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account deactivated',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized',
    });
  }
};

/* =========================
   👑 ADMIN CHECK
========================= */
const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized',
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access only',
    });
  }

  next();
};

/* =========================
   🎯 ROLE AUTHORIZATION
========================= */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' not authorized`,
      });
    }

    next();
  };
};

/* =========================
   💳 RAZORPAY CONFIG CHECK
========================= */
const checkRazorpayConfig = (req, res, next) => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('Razorpay environment variables missing');
    return res.status(500).json({
      success: false,
      message: 'Payment gateway configuration error',
      error: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set',
    });
  }
  next();
};

/* =========================
   ⚡ SEARCH PERFORMANCE LOGGER
========================= */
const searchPerformanceMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const originalJson = res.json;

  res.json = function (data) {
    const responseTime = Date.now() - startTime;

    if (data && typeof data === 'object') {
      data.meta = {
        ...data.meta,
        performance: {
          responseTime: `${responseTime}ms`,
          timestamp: new Date().toISOString(),
          cacheStatus: res.getHeader('X-Cache') || 'miss',
        },
      };
    }

    if (responseTime > 500) {
      console.warn(
        `Slow API detected: ${req.originalUrl} took ${responseTime}ms`
      );
    }

    originalJson.call(this, data);
  };

  next();
};

module.exports = {
  optionalAuth, // 👈 allows anonymous users
  protect,      // 👈 strict auth
  isAdmin,
  authorize,
  checkRazorpayConfig,
  searchPerformanceMiddleware,
};
