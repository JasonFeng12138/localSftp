const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const logger = require('../logger');
const { ClientError } = require('../errors');
const { asyncRoute } = require('../utils');

module.exports = function fileRoutes({ fileService, auth }) {
  const router = express.Router();
  const { requirePermission } = auth;
  const maxUploadMb = parseInt(process.env.MAX_UPLOAD_MB, 10);
  // Multer: store to temp dir, then move via FileService
  const upload = multer({
    dest: path.join(os.tmpdir(), 'sftp-uploads'),
    limits: { files: 1, fields: 5, ...(maxUploadMb > 0 && { fileSize: maxUploadMb * 1024 * 1024 }) }
  });

  const home = req => req.user.homeDir;
  const audit = (req, msg) => logger.info(`[web:${req.user.username}] ${msg}`);
  function requireParam(value, name) {
    if (!value || typeof value !== 'string') throw new ClientError(`${name} required`);
    return value;
  }

  router.use(auth.authenticate);

  // List directory
  router.get('/', requirePermission('read'), asyncRoute(async (req, res) => {
    res.json(await fileService.listDir(req.query.path || '/', home(req)));
  }));

  // File stat
  router.get('/stat', requirePermission('read'), asyncRoute(async (req, res) => {
    res.json(await fileService.stat(req.query.path || '/', home(req)));
  }));

  // Download
  router.get('/download', requirePermission('read'), asyncRoute(async (req, res) => {
    const absPath = fileService.resolvePath(requireParam(req.query.path, 'path'), home(req));
    const stat = await fs.promises.stat(absPath).catch(() => null);
    if (!stat || stat.isDirectory()) throw new ClientError('File not found', 404);
    res.download(absPath, path.basename(absPath), { dotfiles: 'allow' }, err => {
      if (err) logger.error(`Download stream error: ${err.message}`);
    });
  }));

  // Upload（同名文件会被覆盖，编辑器保存依赖此行为）
  router.post('/upload', requirePermission('write'), upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new ClientError('No file uploaded');
    try {
      const targetDir = req.body.path || '/';
      const { name } = await fileService.saveUploadedFile(req.file, targetDir, home(req));
      audit(req, `Uploaded ${JSON.stringify(name)} → ${JSON.stringify(targetDir)}`);
      res.json({ success: true });
    } finally {
      // 失败时清理 multer 临时文件（成功时已被移走，force 忽略不存在）
      fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    }
  }));

  // Mkdir
  router.post('/mkdir', requirePermission('write'), asyncRoute(async (req, res) => {
    await fileService.mkdir(requireParam(req.body.path, 'path'), home(req));
    res.json({ success: true });
  }));

  // Delete
  router.delete('/', requirePermission('delete'), asyncRoute(async (req, res) => {
    const filePath = requireParam(req.query.path, 'path');
    await fileService.remove(filePath, home(req));
    audit(req, `Deleted ${JSON.stringify(filePath)}`);
    res.json({ success: true });
  }));

  // Rename
  router.put('/rename', requirePermission('write'), asyncRoute(async (req, res) => {
    const oldPath = requireParam(req.body.oldPath, 'oldPath');
    const newPath = requireParam(req.body.newPath, 'newPath');
    await fileService.rename(oldPath, newPath, home(req));
    audit(req, `Renamed ${JSON.stringify(oldPath)} → ${JSON.stringify(newPath)}`);
    res.json({ success: true });
  }));

  return router;
};
