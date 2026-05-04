const jwt = require('jsonwebtoken');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const JWT_EXPIRES_IN = '24h';

// sessionKey -> revokedAt (ms timestamp), for kicking web sessions
const sessionBlacklist = new Map();

function generateToken(user) {
  return jwt.sign(
    { username: user.username, role: user.role, permissions: user.permissions, homeDir: user.homeDir || '/' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Revoke a specific session identified by `${username}@${ip}`.
 * Any token for that user from that IP issued before now will be rejected.
 */
function revokeSession(sessionKey) {
  sessionBlacklist.set(sessionKey, Date.now());
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    // Check if this session has been revoked
    const clientIp = (req.ip || '').replace(/^::ffff:/, '');
    const sessionKey = `${req.user.username}@${clientIp}`;
    const revokedAt = sessionBlacklist.get(sessionKey);
    if (revokedAt && req.user.iat * 1000 < revokedAt) {
      return res.status(401).json({ error: 'Session has been revoked' });
    }
    next();
  } catch (err) {
    logger.warn(`Invalid token from ${req.ip}: ${err.message}`);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const has = perms.every(p => req.user.permissions.includes(p));
    if (!has) {
      return res.status(403).json({ error: `Required permissions: ${perms.join(', ')}` });
    }
    next();
  };
}

module.exports = { generateToken, verifyToken, authMiddleware, adminMiddleware, requirePermission, revokeSession };
