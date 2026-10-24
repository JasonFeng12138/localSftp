const express = require('express');
const logger = require('../logger');
const { ClientError } = require('../errors');
const { applySftpRoot } = require('../config');
const { isLocalRequest, asyncRoute, listHomeSubdirs } = require('../utils');

/** 首次初始化。仅在没有任何用户时可用，并且只接受本机访问，防止局域网内他人抢先注册管理员 */
module.exports = function setupRoutes({ userManager, fileService }) {
  const router = express.Router();
  let inProgress = false;

  router.get('/status', (req, res) => {
    res.json({ needSetup: userManager.isEmpty });
  });

  function setupGuard(req, res, next) {
    if (!userManager.isEmpty) return res.status(403).json({ error: '已初始化，禁止重复操作' });
    if (!isLocalRequest(req)) return res.status(403).json({ error: '初始化只能在本机上完成' });
    next();
  }

  // 完成初始化：创建管理员 + 设置存储目录
  router.post('/complete', setupGuard, asyncRoute(async (req, res) => {
    // bcrypt 是异步的，加锁防止并发请求同时创建多个管理员
    if (inProgress) throw new ClientError('初始化正在进行中', 409);
    inProgress = true;
    try {
      const { username, password, sftpRoot } = req.body || {};
      if (!username || !password) throw new ClientError('用户名和密码不能为空');
      if (sftpRoot) applySftpRoot(fileService, sftpRoot);
      await userManager.createUser({ username, password, role: 'admin' });
      logger.info(`Setup complete. Admin user "${username}" created.`);
      res.json({ ok: true });
    } finally {
      inProgress = false;
    }
  }));

  // 列出用户家目录下的子文件夹（供存储路径选择器使用）
  router.get('/dirs', setupGuard, (req, res) => {
    const result = listHomeSubdirs(req.query.path);
    if (!result) return res.status(403).json({ error: '只能浏览用户目录' });
    res.json(result);
  });

  return router;
};
