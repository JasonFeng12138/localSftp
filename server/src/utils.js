const fs = require('fs');
const os = require('os');
const path = require('path');

/** target 是否位于 base 之内（含 base 本身）。使用 path.relative，在 Windows 上大小写不敏感 */
function isWithin(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** 大小写不敏感的文件系统上 "a.txt" 与 "A.txt" 指向同一文件（用于允许仅改大小写的重命名） */
function sameFile(a, b) {
  try {
    const sa = fs.statSync(a, { bigint: true });
    const sb = fs.statSync(b, { bigint: true });
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/** 本机非回环 IPv4 地址 */
function getLanAddresses() {
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) result.push({ name, address: addr.address });
    }
  }
  return result;
}

function normalizeIp(ip) {
  return (ip || '').replace(/^::ffff:/, '');
}

function isLoopbackIp(ip) {
  const v = normalizeIp(ip);
  return v === '::1' || v.startsWith('127.');
}

/**
 * 请求是否来自本机：既检查 TCP 对端地址，也检查 Host 头（防御 DNS 重绑定 ——
 * 恶意网页把自己的域名解析到 127.0.0.1 后，对端地址同样是回环地址）
 */
function isLocalRequest(req) {
  const hostOk = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(req.hostname);
  return hostOk && isLoopbackIp(req.socket.remoteAddress);
}

/** Express 4 不会捕获 async 路由抛出的异常，用它包一层交给统一错误处理中间件 */
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * 列出用户家目录范围内某个目录的非隐藏子目录（存储路径选择器使用）。
 * 超出家目录时返回 null。
 */
function listHomeSubdirs(requested) {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(requested || home);
  if (!isWithin(home, resolved)) return null;
  try {
    const dirs = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));
    return { current: resolved, dirs };
  } catch {
    return { current: resolved, dirs: [] };
  }
}

module.exports = {
  isWithin, sameFile, getLanAddresses, normalizeIp, isLoopbackIp, isLocalRequest, asyncRoute, listHomeSubdirs
};
