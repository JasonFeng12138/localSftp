const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

class UserManager {
  constructor() {
    this.users = [];
    this._ensureDataDir();
    this._load();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _load() {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      this.users = data.users || [];
      logger.info(`Loaded ${this.users.length} user(s) from ${USERS_FILE}`);
    } else {
      this.users = [];
    }
  }

  _save() {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: this.users }, null, 2), 'utf-8');
  }

  async initDefaultAdmin(username, password) {
    if (this.users.length === 0) {
      await this.createUser({
        username,
        password,
        role: 'admin',
        homeDir: '/',
        permissions: ['read', 'write', 'delete', 'admin']
      });
      logger.info(`Default admin user "${username}" created`);
    }
  }

  async createUser({ username, password, role = 'user', homeDir = '/', permissions = ['read', 'write'] }) {
    if (this.findUser(username)) {
      throw new Error(`User "${username}" already exists`);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      username,
      passwordHash,
      role,
      homeDir,
      permissions,
      createdAt: new Date().toISOString(),
      enabled: true
    };
    this.users.push(user);
    this._save();
    return this._sanitize(user);
  }

  findUser(username) {
    return this.users.find(u => u.username === username);
  }

  async verifyPassword(username, password) {
    const user = this.findUser(username);
    if (!user || !user.enabled) return null;
    const match = await bcrypt.compare(password, user.passwordHash);
    return match ? this._sanitize(user) : null;
  }

  listUsers() {
    return this.users.map(u => this._sanitize(u));
  }

  async updateUser(username, updates) {
    const user = this.findUser(username);
    if (!user) throw new Error(`User "${username}" not found`);

    if (updates.password) {
      user.passwordHash = await bcrypt.hash(updates.password, 10);
    }
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.homeDir !== undefined) user.homeDir = updates.homeDir;
    if (updates.permissions !== undefined) user.permissions = updates.permissions;
    if (updates.enabled !== undefined) user.enabled = updates.enabled;

    this._save();
    return this._sanitize(user);
  }

  deleteUser(username) {
    const idx = this.users.findIndex(u => u.username === username);
    if (idx === -1) throw new Error(`User "${username}" not found`);
    this.users.splice(idx, 1);
    this._save();
  }

  _sanitize(user) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}

module.exports = UserManager;
