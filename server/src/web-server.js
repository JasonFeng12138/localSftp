const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { generateToken, authMiddleware, adminMiddleware, requirePermission, revokeSession } = require('./auth');
const logger = require('./logger');

function createWebServer(userManager, fileService, sftpServer) {
  const app = express();
  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  // Track active web sessions (authenticated browser users)
  const WEB_SESSION_TTL_MS = 10 * 60 * 1000; // 10 分钟无活动后清理
  const webSessions = new Map(); // key: `${username}@${ip}`
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (req.user && res.statusCode < 400) {
        const clientIp = (req.ip || '').replace(/^::ffff:/, '');
        const key = `${req.user.username}@${clientIp}`;
        const now = Date.now();
        webSessions.set(key, {
          sessionKey: key,
          username: req.user.username,
          role: req.user.role,
          ip: clientIp,
          lastSeen: new Date(now).toISOString(),
          userAgent: req.headers['user-agent'] || ''
        });
        // 惰性清理过期会话
        for (const [k, v] of webSessions) {
          if (now - new Date(v.lastSeen).getTime() > WEB_SESSION_TTL_MS) {
            webSessions.delete(k);
          }
        }
      }
    });
    next();
  });

  // Multer: store to temp dir, then move via FileService
  const upload = multer({ dest: path.join(os.tmpdir(), 'sftp-uploads') });

  // --- Serve client static files (production) ---
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
  }

  // ===================== Setup (首次初始化，无需认证) =====================

  // 检查是否需要初始化（无任何用户时返回 needSetup: true）
  app.get('/api/setup/status', (req, res) => {
    res.json({ needSetup: userManager.users.length === 0 });
  });

  // 完成初始化：创建管理员 + 设置存储目录
  app.post('/api/setup/complete', async (req, res) => {
    if (userManager.users.length > 0) {
      return res.status(403).json({ error: '已初始化，禁止重复操作' });
    }
    const { username, password, sftpRoot: newRoot } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    // 设置存储路径
    if (newRoot && typeof newRoot === 'string') {
      const resolved = path.resolve(newRoot);
      const forbidden = ['/', '/etc', '/usr', '/bin', '/sbin', '/System'];
      if (forbidden.includes(resolved)) {
        return res.status(400).json({ error: '不允许使用该系统目录' });
      }
      try {
        if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
        fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
        fileService.rootDir = resolved;
        const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
        const settingsFile = path.join(dataDir, 'settings.json');
        let existing = {};
        if (fs.existsSync(settingsFile)) {
          try { existing = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch {}
        }
        fs.writeFileSync(settingsFile, JSON.stringify({ ...existing, sftpRoot: resolved }, null, 2));
      } catch (err) {
        return res.status(400).json({ error: `存储目录设置失败: ${err.message}` });
      }
    }
    try {
      await userManager.createUser({
        username,
        password,
        role: 'admin',
        homeDir: '/',
        permissions: ['read', 'write', 'delete', 'admin']
      });
      logger.info(`Setup complete. Admin user "${username}" created.`);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 列出用户家目录下的子文件夹（供存储路径选择器使用，无需登录）
  app.get('/api/setup/dirs', (req, res) => {
    // 已初始化后禁止访问
    if (userManager.users.length > 0) {
      return res.status(403).json({ error: '已初始化，禁止访问' });
    }
    const home = path.resolve(os.homedir());
    const base = req.query.path || home;
    const resolved = path.resolve(base);
    const relative = path.relative(home, resolved);
    // 只允许浏览用户家目录范围内
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return res.status(403).json({ error: '只能浏览用户目录' });
    }
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));
      res.json({ current: resolved, dirs });
    } catch {
      res.json({ current: resolved, dirs: [] });
    }
  });

  // ===================== Auth =====================

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    try {
      const user = await userManager.verifyPassword(username, password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = generateToken(user);
      res.json({ token, user });
    } catch (err) {
      logger.error(`Login error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ===================== Files =====================

  // List directory
  app.get('/api/files', authMiddleware, requirePermission('read'), async (req, res) => {
    try {
      const dirPath = req.query.path || '/';
      const files = await fileService.listDir(dirPath, req.user.homeDir || '/');
      res.json(files);
    } catch (err) {
      logger.error(`List dir error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  });

  // File stat
  app.get('/api/files/stat', authMiddleware, requirePermission('read'), async (req, res) => {
    try {
      const filePath = req.query.path || '/';
      const stat = await fileService.stat(filePath, req.user.homeDir || '/');
      res.json(stat);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Download
  app.get('/api/files/download', authMiddleware, requirePermission('read'), (req, res) => {
    try {
      const filePath = req.query.path;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      const absPath = fileService.getAbsolutePath(filePath, req.user.homeDir || '/');
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        return res.status(404).json({ error: 'File not found' });
      }
      res.download(absPath);
    } catch (err) {
      logger.error(`Download error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  });

  // Upload
  app.post('/api/files/upload', authMiddleware, requirePermission('write'), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const targetDir = req.body.path || '/';
      await fileService.saveUploadedFile(req.file, targetDir, req.user.homeDir || '/');
      logger.info(`File uploaded: ${Buffer.from(req.file.originalname, 'latin1').toString('utf8')} → ${targetDir}`);
      res.json({ success: true });
    } catch (err) {
      logger.error(`Upload error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  });

  // Mkdir
  app.post('/api/files/mkdir', authMiddleware, requirePermission('write'), async (req, res) => {
    try {
      const { path: dirPath } = req.body;
      if (!dirPath) return res.status(400).json({ error: 'path required' });
      await fileService.mkdir(dirPath, req.user.homeDir || '/');
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete
  app.delete('/api/files', authMiddleware, requirePermission('delete'), async (req, res) => {
    try {
      const filePath = req.query.path;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      await fileService.remove(filePath, req.user.homeDir || '/');
      logger.info(`Deleted: ${filePath}`);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Rename
  app.put('/api/files/rename', authMiddleware, requirePermission('write'), async (req, res) => {
    try {
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
      await fileService.rename(oldPath, newPath, req.user.homeDir || '/');
      logger.info(`Renamed: ${oldPath} → ${newPath}`);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===================== Users =====================

  app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
    res.json(userManager.listUsers());
  });

  app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
      const user = await userManager.createUser(req.body);
      res.json(user);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/users/:username', authMiddleware, adminMiddleware, async (req, res) => {
    try {
      const user = await userManager.updateUser(req.params.username, req.body);
      res.json(user);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/users/:username', authMiddleware, adminMiddleware, (req, res) => {
    try {
      userManager.deleteUser(req.params.username);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===================== Status =====================

  app.get('/api/status', authMiddleware, (req, res) => {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          ips.push({ name, address: addr.address });
        }
      }
    }
    res.json({
      sftpPort: sftpServer.port,
      webPort: process.env.WEB_PORT || 3000,
      sftpConnections: sftpServer.getConnectionCount(),
      uptime: Math.floor(process.uptime()),
      platform: os.platform(),
      hostname: os.hostname(),
      networkInterfaces: ips,
      memoryUsage: process.memoryUsage().rss,
      sftpRoot: fileService.rootDir
    });
  });

  // 快速连接信息：局域网地址 + 当前 SFTP 连接详情（仅管理员）
  app.get('/api/connections', authMiddleware, adminMiddleware, (req, res) => {
    const interfaces = os.networkInterfaces();
    const lanAddresses = [];
    for (const addrs of Object.values(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          lanAddresses.push(addr.address);
        }
      }
    }
    const webPort = process.env.WEB_PORT || 3000;
    // Filter web sessions active within last 10 minutes
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const activeWebSessions = Array.from(webSessions.values())
      .filter(s => new Date(s.lastSeen).getTime() > tenMinutesAgo);
    res.json({
      webPort,
      sftpPort: sftpServer.port,
      lanAddresses,
      sftpConnections: sftpServer.getConnections(),
      webSessions: activeWebSessions
    });
  });

  // 踢出 Web 会话（仅管理员）—— 必须在 /:connId 之前注册，否则 Express 会把 "web" 当作 connId
  app.delete('/api/connections/web/:sessionKey', authMiddleware, adminMiddleware, (req, res) => {
    const sessionKey = decodeURIComponent(req.params.sessionKey);
    if (!webSessions.has(sessionKey)) {
      return res.status(404).json({ error: '会话不存在' });
    }
    revokeSession(sessionKey);
    webSessions.delete(sessionKey);
    logger.info(`Admin "${req.user.username}" revoked web session ${sessionKey}`);
    res.json({ ok: true });
  });

  // 踢出 SFTP 连接（仅管理员）
  app.delete('/api/connections/:connId', authMiddleware, adminMiddleware, (req, res) => {
    const { connId } = req.params;
    const ok = sftpServer.kickConnection(connId);
    if (!ok) return res.status(404).json({ error: '连接不存在' });
    logger.info(`Admin "${req.user.username}" kicked SFTP connection ${connId}`);
    res.json({ ok: true });
  });

  // ===================== Settings =====================

  app.put('/api/settings', authMiddleware, adminMiddleware, async (req, res) => {
    const { sftpRoot: newRoot } = req.body;
    if (!newRoot || typeof newRoot !== 'string') {
      return res.status(400).json({ error: '路径不能为空' });
    }
    const resolved = path.resolve(newRoot);
    // 路径安全检查：不允许系统关键目录
    const forbidden = ['/', '/etc', '/usr', '/bin', '/sbin', '/System', '/Library/System'];
    if (forbidden.includes(resolved)) {
      return res.status(400).json({ error: '不允许使用该系统目录' });
    }
    try {
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      // 验证可读写
      fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
      // 更新 fileService（SftpServer 共享同一实例，自动生效）
      fileService.rootDir = resolved;
      // 持久化到 settings.json
      const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
      const settingsFile = path.join(dataDir, 'settings.json');
      let existing = {};
      if (fs.existsSync(settingsFile)) {
        try { existing = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch {}
      }
      fs.writeFileSync(settingsFile, JSON.stringify({ ...existing, sftpRoot: resolved }, null, 2));
      logger.info(`SFTP root changed to: ${resolved}`);
      res.json({ sftpRoot: resolved });
    } catch (err) {
      logger.error(`Settings update error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  });

  // 列出目录子文件夹（已登录，供修改路径时使用）
  app.get('/api/settings/dirs', authMiddleware, adminMiddleware, (req, res) => {
    const home = path.resolve(os.homedir());
    const base = req.query.path || home;
    const resolved = path.resolve(base);
    const relative = path.relative(home, resolved);
    const isWithinHome = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (!isWithinHome) {
      return res.status(403).json({ error: '只能浏览用户目录' });
    }
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));
      res.json({ current: resolved, dirs });
    } catch {
      res.json({ current: resolved, dirs: [] });
    }
  });

  // SPA fallback — serve client index.html for non-api routes
  if (fs.existsSync(clientDist)) {
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(clientDist, 'index.html'));
      }
    });
  }

  return app;
}

module.exports = createWebServer;
