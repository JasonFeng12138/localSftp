const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const logger = require('./logger');
const { createAuth } = require('./auth');
const { toClientError } = require('./errors');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Element Plus 使用内联样式
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * 前端与 API 同源部署（生产由本服务托管静态文件，开发由 Vite 代理），因此不启用 CORS。
 * 之前的 cors({ origin: true }) 会允许任意网站跨域调用本服务的接口。
 */
function createWebServer({ userManager, fileService, sftpServer, jwtSecret }) {
  const app = express();
  app.disable('x-powered-by');
  // 接口只用到扁平的 query 参数，用 Node 内置 querystring 代替 qs，规避 qs 的解析类 DoS 问题
  app.set('query parser', 'simple');
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));

  const auth = createAuth(userManager, jwtSecret);
  const deps = { userManager, fileService, sftpServer, auth };

  // --- Serve client static files (production) ---
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  const hasClient = fs.existsSync(clientDist);
  if (hasClient) app.use(express.static(clientDist));

  app.use('/api/setup', require('./routes/setup')(deps));
  app.use('/api/auth', require('./routes/auth')(deps));
  app.use('/api/files', require('./routes/files')(deps));
  app.use('/api/users', require('./routes/users')(deps));
  app.use('/api', require('./routes/system')(deps));

  // 未匹配的 API 返回 404（之前会落入 SPA fallback 而永远不响应）
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // SPA fallback — serve client index.html for non-api routes
  if (hasClient) {
    app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // 统一错误处理：只返回脱敏信息，不向客户端暴露堆栈或服务器绝对路径
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `上传失败: ${err.code}` });
    }
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(err.status || 400).json({ error: '请求体格式错误或过大' });
    }
    const { status, message } = toClientError(err);
    const user = req.user ? req.user.username : '-';
    const line = `${req.method} ${req.path} [${user}] → ${status}: ${err.message}`;
    if (status >= 500) logger.error(`${line}\n${err.stack}`);
    else logger.warn(line);
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = createWebServer;
