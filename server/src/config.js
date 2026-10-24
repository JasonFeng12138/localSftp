const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const { ClientError } = require('./errors');
const { isWithin } = require('./utils');

// 所有路径在调用时读取环境变量：Electron 会在 require 服务端代码之前设置它们
const paths = {
  get dataDir() { return process.env.DATA_DIR || path.join(__dirname, '..', 'data'); },
  get hostKeysDir() { return process.env.HOST_KEYS_DIR || path.join(__dirname, '..', 'host-keys'); },
  get logsDir() { return process.env.LOGS_DIR || path.join(__dirname, '..', 'logs'); },
  get settingsFile() { return path.join(this.dataDir, 'settings.json'); }
};

/** 原子写文件：先写临时文件再 rename，避免进程中途退出导致 JSON 损坏 */
function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ===================== settings.json =====================

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(paths.settingsFile, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  writeFileAtomic(paths.settingsFile, JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
}

// ===================== JWT secret =====================

const WEAK_SECRETS = new Set(['', 'fallback-secret', 'your-secret-key-change-me', 'secret', 'changeme']);

/**
 * 环境变量提供了足够强的密钥则使用之；否则在 DATA_DIR 下生成并持久化一个随机密钥。
 * 绝不能回退到写死在源码里的默认值 —— 否则任何人都能伪造管理员 Token。
 */
function getJwtSecret() {
  const fromEnv = process.env.JWT_SECRET || '';
  if (!WEAK_SECRETS.has(fromEnv) && fromEnv.length >= 32) return fromEnv;
  if (fromEnv) logger.warn('JWT_SECRET 过弱或为示例值，已忽略，改用自动生成的随机密钥');

  const file = path.join(paths.dataDir, 'jwt-secret');
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (existing.length >= 32) return existing;
  } catch {}
  const secret = crypto.randomBytes(48).toString('hex');
  writeFileAtomic(file, secret);
  logger.info(`Generated JWT secret at ${file}`);
  return secret;
}

// ===================== SFTP root 校验 =====================

function systemDirs() {
  const dirs = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/proc', '/sys', '/dev', '/System', '/Library'];
  if (process.platform === 'win32') {
    dirs.push(
      process.env.SystemRoot || 'C:\\Windows',
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env.ProgramData || 'C:\\ProgramData'
    );
  }
  return dirs.map(d => path.resolve(d));
}

/**
 * 校验存储根目录。除系统目录外，还必须与程序内部目录（用户库、JWT 密钥、主机私钥、日志）
 * 互不包含 —— 否则 homeDir 为 "/" 的用户就能通过 SFTP 读取密码哈希/私钥，
 * 甚至改写 users.json 给自己提权。
 */
function validateSftpRoot(input) {
  if (!input || typeof input !== 'string') throw new ClientError('路径不能为空');
  if (!path.isAbsolute(input)) throw new ClientError('请填写绝对路径');
  const resolved = path.resolve(input);

  if (path.parse(resolved).root === resolved) throw new ClientError('不允许使用磁盘根目录');
  if (systemDirs().some(d => isWithin(d, resolved))) throw new ClientError('不允许使用系统目录');

  const internal = [paths.dataDir, paths.hostKeysDir, paths.logsDir].map(d => path.resolve(d));
  if (internal.some(d => isWithin(resolved, d) || isWithin(d, resolved))) {
    throw new ClientError('存储目录不能包含程序数据目录，也不能位于其中');
  }
  return resolved;
}

/** 校验 → 创建 → 检查读写权限 → 应用到 fileService → 持久化 */
function applySftpRoot(fileService, input) {
  const resolved = validateSftpRoot(input);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    logger.warn(`SFTP root not usable (${resolved}): ${err.message}`);
    throw new ClientError('存储目录无法创建或没有读写权限');
  }
  fileService.setRoot(resolved);
  saveSettings({ sftpRoot: resolved });
  logger.info(`SFTP root changed to: ${resolved}`);
  return resolved;
}

module.exports = { paths, writeFileAtomic, loadSettings, saveSettings, getJwtSecret, validateSftpRoot, applySftpRoot };
