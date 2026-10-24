const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { ClientError, PathError } = require('./errors');
const { isWithin, sameFile } = require('./utils');

class FileService {
  constructor(rootDir) {
    this.setRoot(rootDir);
  }

  setRoot(rootDir) {
    this.rootDir = path.resolve(rootDir);
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
      logger.info(`Created SFTP root directory: ${this.rootDir}`);
    }
  }

  /** 用户 homeDir 对应的绝对路径，必须在 rootDir 之内 */
  homePath(userHomeDir = '/') {
    const home = path.resolve(this.rootDir, '.' + path.posix.normalize('/' + (userHomeDir || '/')));
    if (!isWithin(this.rootDir, home)) throw new PathError();
    return home;
  }

  /**
   * 把虚拟路径解析为绝对路径，并以 homeDir 作为该用户的 chroot 边界。
   *
   * - 虚拟路径无论是否以 "/" 开头都视为相对 homeDir，防止 "/doc" 这类绝对路径绕过 homeDir
   * - 词法检查之后再做 realpath 检查，防止通过存储目录里已有的符号链接/Windows 目录联接逃逸
   * - allowHome=false 时禁止目标是 homeDir 本身（删除、重命名等操作不能作用于根）
   */
  resolvePath(virtualPath, userHomeDir = '/', { allowHome = true } = {}) {
    const relative = String(virtualPath || '').replace(/^\/+/, '') || '.';
    if (relative.includes('\0') || (process.platform === 'win32' && relative.includes(':'))) {
      throw new PathError();
    }
    const home = this.homePath(userHomeDir);
    const resolved = path.resolve(home, path.posix.normalize(relative));
    if (!isWithin(home, resolved)) throw new PathError();
    if (!allowHome && resolved === home) throw new PathError('不能对根目录执行此操作');
    this._assertRealPathWithin(resolved, home);
    return resolved;
  }

  _assertRealPathWithin(target, home) {
    const boundary = fs.existsSync(home) ? home : this.rootDir;
    let realBoundary;
    try {
      realBoundary = fs.realpathSync.native(boundary);
    } catch {
      return; // 根目录本身不存在时后续操作自然会失败
    }
    // 找到 target 最近的已存在祖先，检查其真实路径
    let existing = target;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return;
      existing = parent;
    }
    const realExisting = fs.realpathSync.native(existing);
    if (!isWithin(realBoundary, realExisting)) throw new PathError();
  }

  async listDir(virtualPath, userHomeDir = '/') {
    const dirPath = this.resolvePath(virtualPath, userHomeDir);
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      try {
        const stat = await fs.promises.stat(path.join(dirPath, entry.name));
        result.push({
          name: entry.name,
          isDirectory: stat.isDirectory(),
          size: stat.size,
          mtime: stat.mtime.toISOString()
        });
      } catch {
        // skip inaccessible entries
      }
    }
    return result;
  }

  async stat(virtualPath, userHomeDir = '/') {
    const filePath = this.resolvePath(virtualPath, userHomeDir);
    const stat = await fs.promises.stat(filePath);
    return {
      name: path.basename(filePath),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      atime: stat.atime.toISOString(),
      ctime: stat.ctime.toISOString()
    };
  }

  async mkdir(virtualPath, userHomeDir = '/') {
    await fs.promises.mkdir(this.resolvePath(virtualPath, userHomeDir), { recursive: true });
  }

  async remove(virtualPath, userHomeDir = '/') {
    const targetPath = this.resolvePath(virtualPath, userHomeDir, { allowHome: false });
    await fs.promises.rm(targetPath, { recursive: true });
  }

  /** 重命名不允许覆盖已有目标（覆盖等同删除，而重命名只要求 write 权限） */
  async rename(oldVPath, newVPath, userHomeDir = '/') {
    const oldPath = this.resolvePath(oldVPath, userHomeDir, { allowHome: false });
    const newPath = this.resolvePath(newVPath, userHomeDir, { allowHome: false });
    if (fs.existsSync(newPath) && !sameFile(oldPath, newPath)) throw new ClientError('目标已存在', 409);
    await fs.promises.rename(oldPath, newPath);
  }

  /** 保存 multer 临时文件到用户目录。文件名只取 basename，杜绝 "../" 形式的路径穿越 */
  async saveUploadedFile(file, virtualDir, userHomeDir = '/') {
    // multer decodes originalname as latin1 by default; re-encode to utf-8
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').split(/[\\/]/).pop();
    if (!name || name === '.' || name === '..') throw new ClientError('文件名非法');

    const dirPath = this.resolvePath(virtualDir, userHomeDir);
    const destPath = this.resolvePath(path.posix.join(String(virtualDir || '/'), name), userHomeDir, { allowHome: false });
    if (path.dirname(destPath) !== dirPath) throw new ClientError('文件名非法');

    await fs.promises.mkdir(dirPath, { recursive: true });
    try {
      await fs.promises.rename(file.path, destPath);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      // 临时目录与存储目录不在同一磁盘时 rename 会失败，退化为复制
      await fs.promises.copyFile(file.path, destPath);
      await fs.promises.unlink(file.path);
    }
    return { name, destPath };
  }
}

module.exports = FileService;
