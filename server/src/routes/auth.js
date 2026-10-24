const express = require('express');
const logger = require('../logger');
const loginLimiter = require('../rate-limiter');
const { ClientError } = require('../errors');
const { asyncRoute, normalizeIp } = require('../utils');

module.exports = function authRoutes({ userManager, auth }) {
  const router = express.Router();

  router.post('/login', asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new ClientError('Username and password required');
    }
    const ip = normalizeIp(req.ip);
    if (loginLimiter.isBlocked(ip, username)) {
      throw new ClientError('登录失败次数过多，请 15 分钟后再试', 429);
    }
    const user = await userManager.verifyPassword(username, password);
    if (!user) {
      loginLimiter.fail(ip, username);
      logger.warn(`Web login failed for ${JSON.stringify(username)} from ${ip}`);
      throw new ClientError('Invalid credentials', 401);
    }
    loginLimiter.succeed(ip, username);
    res.json({ token: auth.generateToken(user), user });
  }));

  // 退出登录：服务端同步作废当前 Token
  router.post('/logout', auth.authenticate, (req, res) => {
    auth.revokeSession(req.user.sid);
    res.json({ ok: true });
  });

  return router;
};
