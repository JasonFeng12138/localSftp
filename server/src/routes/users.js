const express = require('express');
const logger = require('../logger');
const { ClientError } = require('../errors');
const { asyncRoute } = require('../utils');

module.exports = function userRoutes({ userManager, sftpServer, auth }) {
  const router = express.Router();
  router.use(auth.authenticate, auth.adminOnly);

  router.get('/', (req, res) => {
    res.json(userManager.listUsers());
  });

  router.post('/', asyncRoute(async (req, res) => {
    // 只取白名单字段，防止批量赋值（如直接写入 passwordHash/enabled/createdAt）
    const { username, password, role, homeDir, permissions } = req.body || {};
    const user = await userManager.createUser({ username, password, role, homeDir, permissions });
    logger.info(`Admin "${req.user.username}" created user "${user.username}"`);
    res.json(user);
  }));

  router.put('/:username', asyncRoute(async (req, res) => {
    const { password, role, homeDir, permissions, enabled } = req.body || {};
    const user = await userManager.updateUser(req.params.username, { password, role, homeDir, permissions, enabled });
    // 已建立的 SFTP 会话持有旧的权限快照，断开以便按新设置重新登录
    sftpServer.kickUser(user.username);
    logger.info(`Admin "${req.user.username}" updated user "${user.username}"`);
    res.json(user);
  }));

  router.delete('/:username', (req, res) => {
    const { username } = req.params;
    if (username === req.user.username) throw new ClientError('不能删除当前登录的账号');
    userManager.deleteUser(username);
    sftpServer.kickUser(username);
    logger.info(`Admin "${req.user.username}" deleted user "${username}"`);
    res.json({ success: true });
  });

  return router;
};
