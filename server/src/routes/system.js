const os = require('os');
const express = require('express');
const logger = require('../logger');
const { applySftpRoot } = require('../config');
const { getLanAddresses, listHomeSubdirs } = require('../utils');

module.exports = function systemRoutes({ fileService, sftpServer, auth }) {
  const router = express.Router();
  const { authenticate, adminOnly } = auth;
  const webPort = () => parseInt(process.env.WEB_PORT, 10) || 3000;

  // 普通用户只能看到连接所需的基本信息；主机名、存储绝对路径、内存等仅管理员可见
  router.get('/status', authenticate, (req, res) => {
    const base = {
      sftpPort: sftpServer.port,
      webPort: webPort(),
      uptime: Math.floor(process.uptime()),
      networkInterfaces: getLanAddresses()
    };
    if (req.user.role !== 'admin') return res.json(base);
    res.json({
      ...base,
      sftpConnections: sftpServer.getConnectionCount(),
      platform: os.platform(),
      hostname: os.hostname(),
      memoryUsage: process.memoryUsage().rss,
      sftpRoot: fileService.rootDir
    });
  });

  // 快速连接信息：局域网地址 + 当前 SFTP 连接 / Web 会话（仅管理员）
  router.get('/connections', authenticate, adminOnly, (req, res) => {
    res.json({
      webPort: webPort(),
      sftpPort: sftpServer.port,
      lanAddresses: getLanAddresses().map(a => a.address),
      sftpConnections: sftpServer.getConnections(),
      webSessions: auth.listSessions()
    });
  });

  // 踢出 Web 会话 —— 必须在 /:connId 之前注册，否则 Express 会把 "web" 当作 connId
  router.delete('/connections/web/:sessionKey', authenticate, adminOnly, (req, res) => {
    const { sessionKey } = req.params;
    if (!auth.revokeSession(sessionKey)) return res.status(404).json({ error: '会话不存在' });
    logger.info(`Admin "${req.user.username}" revoked web session ${sessionKey}`);
    res.json({ ok: true });
  });

  // 踢出 SFTP 连接
  router.delete('/connections/:connId', authenticate, adminOnly, (req, res) => {
    const { connId } = req.params;
    if (!sftpServer.kickConnection(connId)) return res.status(404).json({ error: '连接不存在' });
    logger.info(`Admin "${req.user.username}" kicked SFTP connection ${connId}`);
    res.json({ ok: true });
  });

  router.put('/settings', authenticate, adminOnly, (req, res) => {
    const sftpRoot = applySftpRoot(fileService, (req.body || {}).sftpRoot);
    res.json({ sftpRoot });
  });

  // 列出目录子文件夹（供修改存储路径时使用）
  router.get('/settings/dirs', authenticate, adminOnly, (req, res) => {
    const result = listHomeSubdirs(req.query.path);
    if (!result) return res.status(403).json({ error: '只能浏览用户目录' });
    res.json(result);
  });

  return router;
};
