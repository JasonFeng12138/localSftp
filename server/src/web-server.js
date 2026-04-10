const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { generateToken, authMiddleware, adminMiddleware, requirePermission } = require('./auth');
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

  // Multer: store to temp dir, then move via FileService
  const upload = multer({ dest: path.join(os.tmpdir(), 'sftp-uploads') });

  // --- Serve client static files (production) ---
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
  }

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
      memoryUsage: process.memoryUsage().rss
    });
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
