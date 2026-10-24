const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const { ClientError } = require('./errors');
const { paths, writeFileAtomic } = require('./config');

const ROLES = ['admin', 'user'];
const PERMISSIONS = ['read', 'write', 'delete', 'admin'];
const USERNAME_RE = /^[\p{L}\p{N}_.@-]{1,32}$/u;
const MIN_PASSWORD_LENGTH = 6;
// 用户不存在时也执行一次 bcrypt 比较，避免通过响应时间枚举用户名
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ClientError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  if (password.length > 128) throw new ClientError('密码过长');
}

/** 规范化 homeDir：统一为 "/a/b" 形式，禁止 ".."、盘符等可能逃出存储根目录的写法 */
function normalizeHomeDir(dir) {
  if (dir === undefined || dir === null || dir === '') return '/';
  if (typeof dir !== 'string') throw new ClientError('主目录格式错误');
  const segments = dir.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.some(s => s === '.' || s === '..' || s.includes(':') || s.includes('\0'))) {
    throw new ClientError('主目录非法');
  }
  return '/' + segments.join('/');
}

/** 角色与权限保持一致：admin 拥有全部权限；普通用户不能带 admin 权限；写/删依赖读 */
function normalizeAccess(role, permissions) {
  if (!ROLES.includes(role)) throw new ClientError('角色无效');
  if (role === 'admin') return { role, permissions: [...PERMISSIONS] };
  if (!Array.isArray(permissions) || permissions.some(p => !PERMISSIONS.includes(p))) {
    throw new ClientError('权限列表无效');
  }
  let perms = [...new Set(permissions)].filter(p => p !== 'admin');
  if (!perms.includes('read')) perms = perms.filter(p => p !== 'write' && p !== 'delete');
  return { role, permissions: PERMISSIONS.filter(p => perms.includes(p)) };
}

class UserManager {
  constructor() {
    this.usersFile = path.join(paths.dataDir, 'users.json');
    this.users = [];
    this._load();
  }

  _load() {
    if (fs.existsSync(this.usersFile)) {
      const data = JSON.parse(fs.readFileSync(this.usersFile, 'utf-8'));
      this.users = data.users || [];
      logger.info(`Loaded ${this.users.length} user(s) from ${this.usersFile}`);
    }
  }

  _save() {
    writeFileAtomic(this.usersFile, JSON.stringify({ users: this.users }, null, 2));
  }

  get isEmpty() {
    return this.users.length === 0;
  }

  async initDefaultAdmin(username, password) {
    if (!this.isEmpty) return;
    await this.createUser({ username, password, role: 'admin' });
    logger.info(`Default admin user "${username}" created`);
  }

  async createUser({ username, password, role = 'user', homeDir = '/', permissions = ['read', 'write'] } = {}) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new ClientError('用户名只能包含字母、数字、_ . @ -，长度 1-32');
    }
    if (this.findUser(username)) throw new ClientError(`用户 "${username}" 已存在`);
    validatePassword(password);

    const user = {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      ...normalizeAccess(role, permissions),
      homeDir: normalizeHomeDir(homeDir),
      createdAt: new Date().toISOString(),
      enabled: true,
      tokenVersion: 0
    };
    // bcrypt 期间可能有并发请求创建了同名用户
    if (this.findUser(username)) throw new ClientError(`用户 "${username}" 已存在`);
    this.users.push(user);
    this._save();
    return this._sanitize(user);
  }

  findUser(username) {
    return this.users.find(u => u.username === username);
  }

  async verifyPassword(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return null;
    const user = this.findUser(username);
    const match = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !match || !user.enabled) return null;
    return this._sanitize(user);
  }

  listUsers() {
    return this.users.map(u => this._sanitize(u));
  }

  _countActiveAdmins(exclude) {
    return this.users.filter(u => u.role === 'admin' && u.enabled && u.username !== exclude).length;
  }

  /**
   * 只接受白名单字段。修改密码或禁用账号会提升 tokenVersion，使该用户已签发的 Token 全部失效。
   */
  async updateUser(username, updates = {}) {
    const user = this.findUser(username);
    if (!user) throw new ClientError(`用户 "${username}" 不存在`, 404);

    const next = { role: user.role, permissions: user.permissions, homeDir: user.homeDir, enabled: user.enabled };
    if (updates.role !== undefined || updates.permissions !== undefined) {
      Object.assign(next, normalizeAccess(
        updates.role !== undefined ? updates.role : user.role,
        updates.permissions !== undefined ? updates.permissions : user.permissions
      ));
    }
    if (updates.homeDir !== undefined) next.homeDir = normalizeHomeDir(updates.homeDir);
    if (updates.enabled !== undefined) {
      if (typeof updates.enabled !== 'boolean') throw new ClientError('enabled 必须为布尔值');
      next.enabled = updates.enabled;
    }
    const losesAdmin = user.role === 'admin' && user.enabled && (next.role !== 'admin' || !next.enabled);
    if (losesAdmin && this._countActiveAdmins(username) === 0) {
      throw new ClientError('至少需要保留一个启用状态的管理员');
    }

    let passwordHash = user.passwordHash;
    if (updates.password) {
      validatePassword(updates.password);
      passwordHash = await bcrypt.hash(updates.password, 10);
    }

    const revokeTokens = passwordHash !== user.passwordHash || (user.enabled && !next.enabled);
    Object.assign(user, next, { passwordHash });
    if (revokeTokens) user.tokenVersion = (user.tokenVersion || 0) + 1;
    this._save();
    return this._sanitize(user);
  }

  deleteUser(username) {
    const idx = this.users.findIndex(u => u.username === username);
    if (idx === -1) throw new ClientError(`用户 "${username}" 不存在`, 404);
    const user = this.users[idx];
    if (user.role === 'admin' && user.enabled && this._countActiveAdmins(username) === 0) {
      throw new ClientError('不能删除最后一个管理员');
    }
    this.users.splice(idx, 1);
    this._save();
  }

  _sanitize(user) {
    const { passwordHash, tokenVersion, ...safe } = user;
    return { ...safe, homeDir: safe.homeDir || '/' };
  }
}

module.exports = UserManager;
