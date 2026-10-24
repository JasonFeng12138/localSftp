const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('ssh2');
const { OPEN_MODE, STATUS_CODE } = require('ssh2').utils.sftp;
const logger = require('./logger');
const loginLimiter = require('./rate-limiter');
const { PathError } = require('./errors');
const { paths } = require('./config');
const { normalizeIp, sameFile } = require('./utils');

const MAX_READ_LENGTH = 256 * 1024; // 单次 READ 上限，防止客户端请求超大 length 耗尽内存
const READDIR_BATCH = 100;

/** fs 错误 → SFTP 状态码 */
function statusFor(err) {
  if (err instanceof PathError) return STATUS_CODE.PERMISSION_DENIED;
  switch (err && err.code) {
    case 'ENOENT': return STATUS_CODE.NO_SUCH_FILE;
    case 'EACCES':
    case 'EPERM': return STATUS_CODE.PERMISSION_DENIED;
    default: return STATUS_CODE.FAILURE;
  }
}

/** SFTP OPEN 标志 → Node 数值 flags（覆盖 CREAT/TRUNC/EXCL/APPEND 的任意组合） */
function toFsFlags(pflags) {
  const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_EXCL, O_APPEND } = fs.constants;
  const read = pflags & OPEN_MODE.READ;
  const write = pflags & OPEN_MODE.WRITE;
  let flags = read && write ? O_RDWR : write ? O_WRONLY : O_RDONLY;
  if (pflags & OPEN_MODE.CREAT) flags |= O_CREAT;
  if (pflags & OPEN_MODE.TRUNC) flags |= O_TRUNC;
  if (pflags & OPEN_MODE.EXCL) flags |= O_EXCL;
  if (pflags & OPEN_MODE.APPEND) flags |= O_APPEND;
  return flags;
}

class SftpServer {
  constructor(userManager, fileService, options = {}) {
    this.userManager = userManager;
    this.fileService = fileService;
    this.port = options.port || 2222;
    this.host = options.host || '0.0.0.0';
    this.connections = new Map();
  }

  _ensureHostKey() {
    const dir = paths.hostKeysDir;
    fs.mkdirSync(dir, { recursive: true });
    const keyFile = path.join(dir, 'host_rsa');
    if (!fs.existsSync(keyFile)) {
      logger.info('Generating RSA host key...');
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 3072,
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

    this.server = new Server({ hostKeys: [hostKey] }, (client, info) => {
      let authedUser = null;
      const connId = `conn-${crypto.randomUUID()}`;
      const clientIp = normalizeIp(info && info.ip) || 'unknown';
      this.connections.set(connId, {
        connId,
        ip: clientIp,
        username: null,
        connectedAt: new Date().toISOString(),
        _client: client   // 内部引用，用于踢出连接
      });
      logger.info(`[${connId}] New SSH connection from ${clientIp}`);

      client.on('authentication', (ctx) => {
        if (ctx.method !== 'password') return ctx.reject(['password']);
        if (loginLimiter.isBlocked(clientIp, ctx.username)) {
          logger.warn(`[${connId}] Auth rate-limited for "${ctx.username}" from ${clientIp}`);
          return ctx.reject();
        }
        this.userManager.verifyPassword(ctx.username, ctx.password)
          .then(user => {
            if (!user) {
              loginLimiter.fail(clientIp, ctx.username);
              logger.warn(`[${connId}] Auth failed for "${ctx.username}"`);
              return ctx.reject();
            }
            loginLimiter.succeed(clientIp, ctx.username);
            authedUser = user;
            const conn = this.connections.get(connId);
            if (conn) conn.username = user.username;
            logger.info(`[${connId}] User "${user.username}" authenticated`);
            ctx.accept();
          })
          .catch(() => ctx.reject());
      });

      client.on('ready', () => {
        logger.info(`[${connId}] Client ready`);
        // 只提供 sftp 子系统；shell/exec/端口转发没有监听器，ssh2 会自动拒绝
        client.on('session', (accept) => {
          const session = accept();
          session.on('sftp', (accept) => {
            this._handleSftp(accept(), authedUser, connId);
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
    const resolve = (p, opts) => fileService.resolvePath(p, user.homeDir, opts);
    const canRead = user.permissions.includes('read');
    const canWrite = user.permissions.includes('write');
    const canDelete = user.permissions.includes('delete');

    // Per-session handle table — prevents cross-connection handle collisions
    const handles = new Map();
    let handleCount = 0;
    function addHandle(entry) {
      const handle = Buffer.from(String(handleCount++));
      handles.set(handle.toString(), entry);
      return handle;
    }

    // Release all open file descriptors when the SFTP session ends
    function cleanupHandles() {
      for (const entry of handles.values()) {
        if (entry.fd !== undefined) { try { fs.closeSync(entry.fd); } catch {} }
      }
      handles.clear();
    }
    sftp.on('end', cleanupHandles);
    sftp.on('close', cleanupHandles);

    /** 所有请求处理器统一兜底：任何同步异常都转换成 SFTP 错误状态，而不是让整个进程崩溃 */
    function on(event, handler) {
      sftp.on(event, (reqid, ...args) => {
        try {
          handler(reqid, ...args);
        } catch (err) {
          if (!(err instanceof PathError) && err.code !== 'ENOENT') {
            logger.warn(`[${connId}] ${event} error: ${err.message}`);
          }
          sftp.status(reqid, statusFor(err));
        }
      });
    }
    const deny = reqid => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    const ok = reqid => sftp.status(reqid, STATUS_CODE.OK);
    const fileHandle = handle => {
      const entry = handles.get(handle.toString());
      if (!entry || entry.fd === undefined) throw new Error('Invalid file handle');
      return entry;
    };

    on('OPEN', (reqid, filename, pflags) => {
      const wantsWrite = pflags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND | OPEN_MODE.CREAT | OPEN_MODE.TRUNC);
      const wantsRead = (pflags & OPEN_MODE.READ) || !wantsWrite;
      if ((wantsRead && !canRead) || (wantsWrite && !canWrite)) return deny(reqid);

      const absPath = resolve(filename, { allowHome: false });
      if (pflags & OPEN_MODE.CREAT) {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
      }
      const fd = fs.openSync(absPath, toFsFlags(pflags));
      sftp.handle(reqid, addHandle({ fd }));
    });

    on('READ', (reqid, handle, offset, length) => {
      const { fd } = fileHandle(handle);
      const buf = Buffer.alloc(Math.min(length, MAX_READ_LENGTH));
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, offset);
      if (bytesRead === 0) sftp.status(reqid, STATUS_CODE.EOF);
      else sftp.data(reqid, buf.subarray(0, bytesRead));
    });

    on('WRITE', (reqid, handle, offset, data) => {
      const { fd } = fileHandle(handle);
      fs.writeSync(fd, data, 0, data.length, offset);
      ok(reqid);
    });

    on('CLOSE', (reqid, handle) => {
      const key = handle.toString();
      const entry = handles.get(key);
      handles.delete(key);
      if (entry && entry.fd !== undefined) fs.closeSync(entry.fd);
      ok(reqid);
    });

    const onStat = (reqid, pathStr) => sftp.attrs(reqid, toAttrs(fs.statSync(resolve(pathStr))));
    on('STAT', onStat);
    on('LSTAT', onStat);

    on('FSTAT', (reqid, handle) => {
      sftp.attrs(reqid, toAttrs(fs.fstatSync(fileHandle(handle).fd)));
    });

    on('OPENDIR', (reqid, dirPath) => {
      if (!canRead) return deny(reqid);
      const virtualDir = toVirtualPath(dirPath);
      const absPath = resolve(virtualDir);
      const entries = fs.readdirSync(absPath);
      sftp.handle(reqid, addHandle({ entries, absPath, virtualDir, pos: -1 }));
    });

    on('READDIR', (reqid, handle) => {
      const entry = handles.get(handle.toString());
      if (!entry || !entry.entries) return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (entry.pos >= entry.entries.length) return sftp.status(reqid, STATUS_CODE.EOF);

      const names = [];
      if (entry.pos === -1) {
        const parentAbs = resolve(path.posix.dirname(entry.virtualDir));
        names.push(nameEntry('.', fs.statSync(entry.absPath)), nameEntry('..', fs.statSync(parentAbs)));
        entry.pos = 0;
      }
      const batch = entry.entries.slice(entry.pos, entry.pos + READDIR_BATCH);
      entry.pos += batch.length;
      for (const name of batch) {
        try {
          names.push(nameEntry(name, fs.statSync(path.join(entry.absPath, name))));
        } catch {
          names.push({ filename: name, longname: name, attrs: {} });
        }
      }
      sftp.name(reqid, names);
    });

    on('REMOVE', (reqid, filename) => {
      if (!canDelete) return deny(reqid);
      fs.unlinkSync(resolve(filename, { allowHome: false }));
      ok(reqid);
    });

    on('RMDIR', (reqid, dirPath) => {
      if (!canDelete) return deny(reqid);
      fs.rmdirSync(resolve(dirPath, { allowHome: false }));
      ok(reqid);
    });

    on('MKDIR', (reqid, dirPath) => {
      if (!canWrite) return deny(reqid);
      fs.mkdirSync(resolve(dirPath, { allowHome: false }), { recursive: true });
      ok(reqid);
    });

    on('RENAME', (reqid, oldPath, newPath) => {
      if (!canWrite) return deny(reqid);
      const absOld = resolve(oldPath, { allowHome: false });
      const absNew = resolve(newPath, { allowHome: false });
      // SFTP v3 语义：目标已存在时 RENAME 失败；同时避免只有 write 权限的用户借改名覆盖（删除）文件
      if (fs.existsSync(absNew) && !sameFile(absOld, absNew)) return sftp.status(reqid, STATUS_CODE.FAILURE);
      fs.renameSync(absOld, absNew);
      ok(reqid);
    });

    // These operations are not supported; return OP_UNSUPPORTED so clients
    // like FileZilla stop retrying and don't show confusing error dialogs.
    for (const event of ['READLINK', 'SYMLINK', 'EXTENDED']) {
      sftp.on(event, reqid => sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED));
    }

    // Accept silently — many clients send SETSTAT after upload to preserve timestamps.
    // Rejecting with FAILURE causes retry loops; OK is harmless here (no chmod/chown is applied).
    sftp.on('SETSTAT', reqid => ok(reqid));
    sftp.on('FSETSTAT', reqid => ok(reqid));

    sftp.on('REALPATH', (reqid, pathStr) => {
      // Many SFTP clients expect PWD/REALPATH to return an absolute path.
      // Map empty and "." to virtual root "/" for chroot-like behavior.
      const virtualPath = toVirtualPath(pathStr);
      try {
        const stat = fs.statSync(resolve(virtualPath));
        sftp.name(reqid, [{ filename: virtualPath, longname: longname(virtualPath, stat), attrs: toAttrs(stat) }]);
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
    try { conn._client.end(); } catch {}
    this.connections.delete(connId);
    logger.info(`[${connId}] Connection kicked`);
    return true;
  }

  /** 断开某用户的全部 SFTP 连接（账号被删除/禁用/改密/调整权限后调用，让新设置立即生效） */
  kickUser(username) {
    for (const conn of Array.from(this.connections.values())) {
      if (conn.username === username) this.kickConnection(conn.connId);
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('SFTP server stopped');
    }
  }
}

/** 规范化客户端传来的路径为以 "/" 开头的虚拟路径 */
function toVirtualPath(input) {
  const normalized = path.posix.normalize(String(input || '').trim() || '/');
  if (normalized === '.' || normalized === '') return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function toAttrs(stat) {
  return {
    mode: stat.mode,
    uid: stat.uid || 0,
    gid: stat.gid || 0,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000)
  };
}

function nameEntry(name, stat) {
  return { filename: name, longname: longname(name, stat), attrs: toAttrs(stat) };
}

function longname(name, stat) {
  const isDir = stat.isDirectory() ? 'd' : '-';
  const size = String(stat.size).padStart(10);
  const d = stat.mtime;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const day = String(d.getDate()).padStart(2);
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${isDir}rwxr-xr-x  1 user group ${size} ${month} ${day} ${time} ${name}`;
}

module.exports = SftpServer;
