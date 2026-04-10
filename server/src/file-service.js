const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class FileService {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
      logger.info(`Created SFTP root directory: ${this.rootDir}`);
    }
  }

  /**
   * Resolve a virtual path to an absolute path, enforcing homeDir as the
   * user's chroot boundary.
   *
   * virtualPath is treated as relative to userHomeDir regardless of whether
   * it starts with '/'. This prevents absolute-path injection such as
   * path.posix.join('/doc/md', '/doc') === '/doc' bypassing homeDir.
   */
  resolvePath(virtualPath, userHomeDir = '/') {
    // Strip all leading slashes so the path is always relative to homeDir
    const relative = (virtualPath || '').replace(/^\/+/, '') || '.';
    const normalized = path.posix.normalize(relative);
    const homeBased = path.posix.join(userHomeDir, normalized);
    const absolute = path.join(this.rootDir, homeBased);
    const resolved = path.resolve(absolute);

    // Compute the absolute home boundary for this user
    const homeAbsolute = path.resolve(path.join(this.rootDir, userHomeDir));

    // Must stay within homeDir (which is itself within rootDir)
    if (!resolved.startsWith(homeAbsolute + path.sep) && resolved !== homeAbsolute) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  async listDir(virtualPath, userHomeDir = '/') {
    const dirPath = this.resolvePath(virtualPath, userHomeDir);
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        result.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
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

  getAbsolutePath(virtualPath, userHomeDir = '/') {
    return this.resolvePath(virtualPath, userHomeDir);
  }

  async mkdir(virtualPath, userHomeDir = '/') {
    const dirPath = this.resolvePath(virtualPath, userHomeDir);
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  async remove(virtualPath, userHomeDir = '/') {
    const targetPath = this.resolvePath(virtualPath, userHomeDir);
    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
  }

  async rename(oldVPath, newVPath, userHomeDir = '/') {
    const oldPath = this.resolvePath(oldVPath, userHomeDir);
    const newPath = this.resolvePath(newVPath, userHomeDir);
    await fs.promises.rename(oldPath, newPath);
  }

  async saveUploadedFile(file, virtualDir, userHomeDir = '/') {
    const dirPath = this.resolvePath(virtualDir, userHomeDir);
    if (!fs.existsSync(dirPath)) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
    // multer decodes originalname as latin1 by default; re-encode to utf-8
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const destPath = path.join(dirPath, originalName);
    await fs.promises.rename(file.path, destPath);
    return destPath;
  }
}

module.exports = FileService;
