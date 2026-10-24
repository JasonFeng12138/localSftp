const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { normalizeIp } = require('./utils');

const JWT_EXPIRES_IN = '24h';
const WEB_SESSION_TTL_MS = 10 * 60 * 1000; // 10 分钟无活动后从在线列表移除

/**
 * Token 只携带身份（用户名 + 会话 ID + tokenVersion），角色/权限/homeDir 每次请求都从
 * UserManager 实时读取。这样管理员禁用、删除、降权或改密后立即生效，而不是要等 Token 过期。
 */
function createAuth(userManager, secret) {
  const revoked = new Map();   // sid -> token 过期时间(ms)，过期后自动清理
  const sessions = new Map();  // sid -> 在线 Web 会话信息（供管理员查看/踢出）

  function generateToken(user) {
    const sid = crypto.randomUUID();
    const record = userManager.findUser(user.username);
    return jwt.sign(
      { sub: user.username, sid, tv: (record && record.tokenVersion) || 0 },
      secret,
      { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
    );
  }

  function prune(now) {
    for (const [sid, exp] of revoked) if (exp < now) revoked.delete(sid);
    for (const [sid, s] of sessions) if (now - s.lastSeenMs > WEB_SESSION_TTL_MS) sessions.delete(sid);
  }

  function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    let payload;
    try {
      payload = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] });
    } catch (err) {
      logger.warn(`Invalid token from ${req.ip}: ${err.message}`);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = userManager.findUser(payload.sub);
    if (!user || !user.enabled || (user.tokenVersion || 0) !== payload.tv || revoked.has(payload.sid)) {
      return res.status(401).json({ error: 'Session has been revoked' });
    }

    req.user = {
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
      homeDir: user.homeDir || '/',
      sid: payload.sid,
      exp: payload.exp
    };

    const now = Date.now();
    const ip = normalizeIp(req.ip);
    sessions.set(payload.sid, {
      sessionKey: payload.sid,
      username: user.username,
      role: user.role,
      ip,
      lastSeen: new Date(now).toISOString(),
      lastSeenMs: now,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      exp: payload.exp
    });
    prune(now);
    next();
  }

  function adminOnly(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }

  function requirePermission(...perms) {
    return (req, res, next) => {
      if (!req.user || !perms.every(p => req.user.permissions.includes(p))) {
        return res.status(403).json({ error: `Required permissions: ${perms.join(', ')}` });
      }
      next();
    };
  }

  /** 撤销单个会话。返回 false 表示该会话不存在 */
  function revokeSession(sid) {
    const s = sessions.get(sid);
    if (!s) return false;
    revoked.set(sid, s.exp * 1000);
    sessions.delete(sid);
    return true;
  }

  function listSessions() {
    prune(Date.now());
    return Array.from(sessions.values()).map(({ lastSeenMs, exp, ...rest }) => rest);
  }

  return { generateToken, authenticate, adminOnly, requirePermission, revokeSession, listSessions };
}

module.exports = { createAuth };
