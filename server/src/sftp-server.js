const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('ssh2');
const { OPEN_MODE } = require('ssh2').utils.sftp;
const logger = require('./logger');

const SFTP_STATUS_CODE = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4
};

class SftpServer {
  constructor(userManager, fileService, options = {}) {
    this.userManager = userManager;
    this.fileService = fileService;
    this.port = options.port || 2222;
    this.host = options.host || '0.0.0.0';
    this.connections = new Map();
    this.hostKeyPath = process.env.HOST_KEYS_DIR || path.join(__dirname, '..', 'host-keys');
  }

  _ensureHostKey() {
    if (!fs.existsSync(this.hostKeyPath)) {
      fs.mkdirSync(this.hostKeyPath, { recursive: true });
    }
    const keyFile = path.join(this.hostKeyPath, 'host_rsa');
    if (!fs.existsSync(keyFile)) {
      logger.info('Generating RSA host key...');
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
      });
      fs.writeFileSync(keyFile, privateKey, { mode: 0o600 });
      logger.info('RSA host key generated');
    }
    return fs.readFileSync(keyFile);
  }

  start() {
    const hostKey = this._ensureHostKey();

    this.server = new Server({ hostKeys: [hostKey] }, (client) => {
      let authedUser = null;
      const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // 获取并规范化客户端 IP（处理 ::ffff: IPv6 映射形式）
      const rawIp = client._sock?.remoteAddress || 'unknown';
      const clientIp = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
      this.connections.set(connId, {
        connId,
        ip: clientIp,
        username: null,
        connectedAt: new Date().toISOString(),
        _client: client   // 内部引用，用于踢出连接
      });
      logger.info(`[${connId}] New SSH connection from ${clientIp}`);

      client.on('authentication', (ctx) => {
        if (ctx.method === 'password') {
          this.userManager.verifyPassword(ctx.username, ctx.password)
            .then(user => {
              if (user) {
                authedUser = { ...user, homeDir: user.homeDir || '/' };
                // 更新连接记录中的用户名
                const conn = this.connections.get(connId);
                if (conn) conn.username = ctx.username;
                logger.info(`[${connId}] User "${ctx.username}" authenticated`);
                ctx.accept();
              } else {
                logger.warn(`[${connId}] Auth failed for "${ctx.username}"`);
                ctx.reject();
              }
            })
            .catch(() => ctx.reject());
        } else {
          ctx.reject(['password']);
        }
      });

      client.on('ready', () => {
        logger.info(`[${connId}] Client ready`);

        client.on('session', (accept) => {
          const session = accept();
          session.on('sftp', (accept) => {
            const sftp = accept();
            this._handleSftp(sftp, authedUser, connId);
          });
        });
      });

      client.on('close', () => {
        this.connections.delete(connId);
        logger.info(`[${connId}] Connection closed (active: ${this.connections.size})`);
      });

      client.on('error', (err) => {
        logger.error(`[${connId}] Client error: ${err.message}`);
      });
    });

    this.server.listen(this.port, this.host, () => {
      logger.info(`SFTP server listening on ${this.host}:${this.port}`);
    });
  }

  _handleSftp(sftp, user, connId) {
    const fileService = this.fileService;
    // Per-session handle table — prevents cross-connection handle collisions
    const handles = new Map();
    let handleCount = 0;
    function nextHandle() { return Buffer.from(String(handleCount++)); }

    // Release all open file descriptors when the SFTP session ends
    function cleanupHandles() {
      for (const entry of handles.values()) {
        if (entry.fd !== undefined) { try { fs.closeSync(entry.fd); } catch {} }
      }
      handles.clear();
    }
    sftp.on('end',   cleanupHandles);
    sftp.on('close', cleanupHandles);

    const canRead = user.permissions.includes('read');
    const canWrite = user.permissions.includes('write');
    const canDelete = user.permissions.includes('delete');

    sftp.on('OPEN', (reqid, filename, flags, attrs) => {
      if (!canRead && !canWrite) {
        return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
      }
      try {
        const absPath = fileService.resolvePath(filename, user.homeDir);
        let fsFlags = 'r';
        if (flags & OPEN_MODE.WRITE) {
          if (!canWrite) return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
          if (flags & OPEN_MODE.APPEND) {
            fsFlags = 'a';
          } else if (flags & OPEN_MODE.CREAT) {
            // Create-or-truncate: auto-create parent directories
            const parentDir = path.dirname(absPath);
            if (!fs.existsSync(parentDir)) {
              fs.mkdirSync(parentDir, { recursive: true });
            }
            fsFlags = (flags & OPEN_MODE.TRUNC) ? 'w' : 'wx';
          } else {
            fsFlags = (flags & OPEN_MODE.TRUNC) ? 'r+' : 'r+';
            if (flags & OPEN_MODE.TRUNC) {
              fs.truncateSync(absPath, 0);
            }
          }
        }
        const fd = fs.openSync(absPath, fsFlags);
        const handle = nextHandle();
        handles.set(handle.toString(), { fd, absPath, flags });
        sftp.handle(reqid, handle);
      } catch (err) {
        logger.error(`[${connId}] OPEN error: ${err.message}`);
        sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      }
    });

    sftp.on('READ', (reqid, handle, offset, length) => {
      const entry = handles.get(handle.toString());
      if (!entry) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      const buf = Buffer.alloc(length);
      const bytesRead = fs.readSync(entry.fd, buf, 0, length, offset);
      if (bytesRead === 0) {
        sftp.status(reqid, SFTP_STATUS_CODE.EOF);
      } else {
        sftp.data(reqid, buf.slice(0, bytesRead));
      }
    });

    sftp.on('WRITE', (reqid, handle, offset, data) => {
      const entry = handles.get(handle.toString());
      if (!entry) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      try {
        fs.writeSync(entry.fd, data, 0, data.length, offset);
        sftp.status(reqid, SFTP_STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      }
    });

    sftp.on('CLOSE', (reqid, handle) => {
      const key = handle.toString();
      const entry = handles.get(key);
      if (entry) {
        if (entry.fd !== undefined) fs.closeSync(entry.fd);
        handles.delete(key);
      }
      sftp.status(reqid, SFTP_STATUS_CODE.OK);
    });

    sftp.on('STAT', onStat);
    sftp.on('LSTAT', onStat);

    function onStat(reqid, pathStr) {
      try {
        const absPath = fileService.resolvePath(pathStr, user.homeDir);
        const stat = fs.statSync(absPath);
        sftp.attrs(reqid, _toAttrs(stat));
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      }
    }

    sftp.on('FSTAT', (reqid, handle) => {
      const entry = handles.get(handle.toString());
      if (!entry) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      try {
        const stat = fs.fstatSync(entry.fd);
        sftp.attrs(reqid, _toAttrs(stat));
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      }
    });

    sftp.on('OPENDIR', (reqid, dirPath) => {
      if (!canRead) return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
      try {
        const normalizedInput = path.posix.normalize((dirPath || '/').trim() || '/');
        const virtualDir = (normalizedInput === '.' || normalizedInput === '')
          ? '/'
          : (normalizedInput.startsWith('/') ? normalizedInput : `/${normalizedInput}`);
        const absPath = fileService.resolvePath(virtualDir, user.homeDir);
        const entries = fs.readdirSync(absPath);
        const handle = nextHandle();
        handles.set(handle.toString(), { entries, absPath, virtualDir, dirRead: false });
        sftp.handle(reqid, handle);
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      }
    });

    sftp.on('READDIR', (reqid, handle) => {
      const entry = handles.get(handle.toString());
      if (!entry || !entry.entries) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      if (entry.dirRead) return sftp.status(reqid, SFTP_STATUS_CODE.EOF);

      entry.dirRead = true;
      const currentStat = fs.statSync(entry.absPath);
      const parentVirtual = entry.virtualDir === '/'
        ? '/'
        : (path.posix.dirname(entry.virtualDir) === '.' ? '/' : path.posix.dirname(entry.virtualDir));
      const parentAbs = fileService.resolvePath(parentVirtual, user.homeDir);
      const parentStat = fs.statSync(parentAbs);

      const names = [
        { filename: '.', longname: _longname('.', currentStat), attrs: _toAttrs(currentStat) },
        { filename: '..', longname: _longname('..', parentStat), attrs: _toAttrs(parentStat) }
      ];

      names.push(...entry.entries.map(name => {
        try {
          const fullPath = path.join(entry.absPath, name);
          const stat = fs.statSync(fullPath);
          return { filename: name, longname: _longname(name, stat), attrs: _toAttrs(stat) };
        } catch {
          return { filename: name, longname: name, attrs: {} };
        }
      }));
      sftp.name(reqid, names);
    });

    sftp.on('REMOVE', (reqid, filename) => {
      if (!canDelete) return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
      try {
        const absPath = fileService.resolvePath(filename, user.homeDir);
        fs.unlinkSync(absPath);
        sftp.status(reqid, SFTP_STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      }
    });

    sftp.on('RMDIR', (reqid, dirPath) => {
      if (!canDelete) return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
      try {
        const absPath = fileService.resolvePath(dirPath, user.homeDir);
        fs.rmdirSync(absPath);
        sftp.status(reqid, SFTP_STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      }
    });

    sftp.on('MKDIR', (reqid, dirPath, attrs) => {
      if (!canWrite) return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
      try {
        const absPath = fileService.resolvePath(dirPath, user.homeDir);
        fs.mkdirSync(absPath, { recursive: true });
        sftp.status(reqid, SFTP_STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      }
    });

    sftp.on('RENAME', (reqid, oldPath, newPath) => {
      if (!canWrite) return sftp.status(reqid, SFTP_STATUS_CODE.PERMISSION_DENIED);
      try {
        const absOld = fileService.resolvePath(oldPath, user.homeDir);
        const absNew = fileService.resolvePath(newPath, user.homeDir);
        fs.renameSync(absOld, absNew);
        sftp.status(reqid, SFTP_STATUS_CODE.OK);
      } catch {
        sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      }
    });

    // These operations are not supported; return OP_UNSUPPORTED (8) so clients
    // like FileZilla stop retrying and don't show confusing error dialogs.
    const OP_UNSUPPORTED = 8;

    sftp.on('READLINK', (reqid) => {
      sftp.status(reqid, OP_UNSUPPORTED);
    });

    sftp.on('SYMLINK', (reqid) => {
      sftp.status(reqid, OP_UNSUPPORTED);
    });

    sftp.on('SETSTAT', (reqid) => {
      // Accept silently — many clients send SETSTAT after upload to preserve timestamps.
      // Rejecting with FAILURE causes retry loops; OK is harmless here.
      sftp.status(reqid, SFTP_STATUS_CODE.OK);
    });

    sftp.on('FSETSTAT', (reqid) => {
      sftp.status(reqid, SFTP_STATUS_CODE.OK);
    });

    // Handle SSH2 extension requests (e.g. statvfs@openssh.com) — return OP_UNSUPPORTED
    sftp.on('EXTENDED', (reqid) => {
      sftp.status(reqid, OP_UNSUPPORTED);
    });

    sftp.on('REALPATH', (reqid, pathStr) => {
      try {
        // Many SFTP clients expect PWD/REALPATH to return an absolute path.
        // Map empty and "." to virtual root "/" for chroot-like behavior.
        const input = (pathStr || '').trim();
        const normalizedInput = path.posix.normalize(input || '/');
        const virtualPath = (normalizedInput === '.' || normalizedInput === '')
          ? '/'
          : (normalizedInput.startsWith('/') ? normalizedInput : `/${normalizedInput}`);

        const absPath = fileService.resolvePath(virtualPath, user.homeDir);
        const stat = fs.statSync(absPath);
        sftp.name(reqid, [{
          filename: virtualPath,
          longname: _longname(virtualPath, stat),
          attrs: _toAttrs(stat)
        }]);
      } catch {
        sftp.name(reqid, [{ filename: '/', longname: '/', attrs: {} }]);
      }
    });
  }

  getConnectionCount() {
    return this.connections.size;
  }

  getConnections() {
    // 返回时过滤掉内部 _client 引用，不暴露给外部
    return Array.from(this.connections.values()).map(({ _client, ...rest }) => rest);
  }

  kickConnection(connId) {
    const conn = this.connections.get(connId);
    if (!conn) return false;
    try {
      conn._client.end();
    } catch {}
    this.connections.delete(connId);
    logger.info(`[${connId}] Connection kicked by admin`);
    return true;
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('SFTP server stopped');
    }
  }
}

function _toAttrs(stat) {
  return {
    mode: stat.mode,
    uid: stat.uid || 0,
    gid: stat.gid || 0,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000)
  };
}

function _longname(name, stat) {
  const isDir = stat.isDirectory() ? 'd' : '-';
  const size = String(stat.size).padStart(10);
  const d = stat.mtime;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const day = String(d.getDate()).padStart(2);
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${isDir}rwxr-xr-x  1 user group ${size} ${month} ${day} ${time} ${name}`;
}

module.exports = SftpServer;
