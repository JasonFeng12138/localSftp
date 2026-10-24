// 安全回归测试：npm test
// 在临时目录中启动完整服务（Web + SFTP），从外部以攻击者视角验证各项防护。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Client } = require('ssh2');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-sec-'));
const ROOT = path.join(tmp, 'root');
const OUTSIDE = path.join(tmp, 'outside');
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'),
  HOST_KEYS_DIR: path.join(tmp, 'keys'),
  LOGS_DIR: path.join(tmp, 'logs'),
  SFTP_ROOT: ROOT,
  WEB_PORT: '38123',
  SFTP_PORT: '38124',
  WEB_HOST: '127.0.0.1',
  SFTP_HOST: '127.0.0.1',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'Admin-Pass-1',
  JWT_SECRET: 'fallback-secret'
});
const BASE = `http://127.0.0.1:${process.env.WEB_PORT}/api`;

async function call(method, url, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers: h, body: payload, signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const login = async (u, p) => (await call('POST', '/auth/login', { body: { username: u, password: p } })).data.token;

function sftpConnect(username, password) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => conn.sftp((err, sftp) => (err ? reject(err) : resolve({ conn, sftp }))))
      .on('error', reject)
      .connect({ host: '127.0.0.1', port: +process.env.SFTP_PORT, username, password, readyTimeout: 5000 });
  });
}
const p = (fn) => new Promise((resolve) => fn((err, res) => resolve({ err, res })));

let admin;
test.before(async () => {
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'top secret');
  await require('../src/index.js')();
  await new Promise(r => setTimeout(r, 500));
  admin = await login('admin', 'Admin-Pass-1');
  assert.ok(admin, 'admin login');
});
test.after(() => setImmediate(() => process.exit(0)));

test('弱 JWT_SECRET 被忽略，用源码默认密钥伪造的 Token 无效', async () => {
  const forged = jwt.sign({ sub: 'admin', username: 'admin', role: 'admin', permissions: ['admin'], homeDir: '/', tv: 0 }, 'fallback-secret');
  assert.strictEqual((await call('GET', '/users', { token: forged })).status, 401);
});

test('安全响应头存在，CORS 不再反射任意 Origin', async () => {
  const r = await call('GET', '/setup/status', { headers: { Origin: 'http://evil.example' } });
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
  assert.strictEqual(r.headers.get('x-powered-by'), null);
});

test('已初始化后 setup 接口不可用；未知 API 立即 404', async () => {
  assert.strictEqual((await call('POST', '/setup/complete', { body: { username: 'x', password: 'xxxxxxx' } })).status, 403);
  assert.strictEqual((await call('GET', '/setup/dirs')).status, 403);
  assert.strictEqual((await call('GET', '/nope')).status, 404);
});

test('创建用户：非法 homeDir/用户名被拒绝，批量赋值字段被忽略', async () => {
  assert.strictEqual((await call('POST', '/users', { token: admin, body: { username: 'x1', password: 'pass123', homeDir: '../../' } })).status, 400);
  assert.strictEqual((await call('POST', '/users', { token: admin, body: { username: '../a', password: 'pass123' } })).status, 400);
  assert.strictEqual((await call('POST', '/users', { token: admin, body: { username: 'x2', password: '1' } })).status, 400);
  const r = await call('POST', '/users', {
    token: admin,
    body: { username: 'bob', password: 'bob-pass', homeDir: '/bob', permissions: ['read', 'write', 'admin'], passwordHash: 'x', role: 'user' }
  });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.permissions, ['read', 'write']);
  assert.strictEqual(r.data.passwordHash, undefined);
  fs.mkdirSync(path.join(ROOT, 'bob'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'admin-only.txt'), 'admin');
});

test('普通用户：无法越出 homeDir，错误信息不泄露服务器路径', async () => {
  const bob = await login('bob', 'bob-pass');
  for (const q of ['../', '/../admin-only.txt', '..\\admin-only.txt', '/bob/../../']) {
    const r = await call('GET', `/files/download?path=${encodeURIComponent(q)}`, { token: bob });
    assert.ok([403, 404].includes(r.status), `${q} → ${r.status}`);
    assert.ok(!JSON.stringify(r.data).includes(tmp), 'error leaks path');
  }
  const missing = await call('GET', '/files/stat?path=/nope', { token: bob });
  assert.strictEqual(missing.status, 404);
  assert.ok(!JSON.stringify(missing.data).includes(tmp));
  assert.strictEqual((await call('GET', '/users', { token: bob })).status, 403);
  assert.strictEqual((await call('DELETE', '/files?path=/x', { token: bob })).status, 403);
});

test('上传文件名中的 ../ 被剥离', async () => {
  const bob = await login('bob', 'bob-pass');
  const form = new FormData();
  form.append('path', '/');
  form.append('file', new Blob(['pwn']), '../../evil.txt');
  const r = await call('POST', '/files/upload', { token: bob, form });
  assert.strictEqual(r.status, 200);
  assert.ok(fs.existsSync(path.join(ROOT, 'bob', 'evil.txt')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'evil.txt')) && !fs.existsSync(path.join(tmp, 'evil.txt')));
});

test('符号链接 / 目录联接无法用来逃出存储目录', async () => {
  fs.symlinkSync(OUTSIDE, path.join(ROOT, 'bob', 'link'), 'junction');
  const bob = await login('bob', 'bob-pass');
  const r = await call('GET', '/files/download?path=/link/secret.txt', { token: bob });
  assert.strictEqual(r.status, 403);
});

test('不能删除或重命名根目录；重命名不能覆盖已有文件', async () => {
  assert.strictEqual((await call('DELETE', '/files?path=/', { token: admin })).status, 403);
  assert.strictEqual((await call('PUT', '/files/rename', { token: admin, body: { oldPath: '/', newPath: '/x' } })).status, 403);
  fs.writeFileSync(path.join(ROOT, 'a.txt'), 'a');
  const r = await call('PUT', '/files/rename', { token: admin, body: { oldPath: '/a.txt', newPath: '/admin-only.txt' } });
  assert.strictEqual(r.status, 409);
});

test('/status 对普通用户隐藏敏感信息', async () => {
  const bob = await login('bob', 'bob-pass');
  const r = await call('GET', '/status', { token: bob });
  assert.strictEqual(r.data.sftpRoot, undefined);
  assert.strictEqual(r.data.hostname, undefined);
  assert.ok((await call('GET', '/status', { token: admin })).data.sftpRoot);
});

test('存储目录不能设为包含程序数据目录的位置', async () => {
  const r = await call('PUT', '/settings', { token: admin, body: { sftpRoot: tmp } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await call('PUT', '/settings', { token: admin, body: { sftpRoot: 'relative/path' } })).status, 400);
});

test('禁用/改密/退出登录后旧 Token 立即失效；降权立即生效', async () => {
  let bob = await login('bob', 'bob-pass');
  await call('PUT', '/users/bob', { token: admin, body: { enabled: false } });
  assert.strictEqual((await call('GET', '/files', { token: bob })).status, 401);
  await call('PUT', '/users/bob', { token: admin, body: { enabled: true } });
  assert.strictEqual((await call('GET', '/files', { token: bob })).status, 401, 'token stays revoked after re-enable');

  bob = await login('bob', 'bob-pass');
  await call('PUT', '/users/bob', { token: admin, body: { permissions: [] } });
  assert.strictEqual((await call('GET', '/files', { token: bob })).status, 403);
  await call('PUT', '/users/bob', { token: admin, body: { permissions: ['read', 'write'] } });

  await call('PUT', '/users/bob', { token: admin, body: { password: 'bob-pass-2' } });
  assert.strictEqual((await call('GET', '/files', { token: bob })).status, 401);

  bob = await login('bob', 'bob-pass-2');
  assert.strictEqual((await call('POST', '/auth/logout', { token: bob })).status, 200);
  assert.strictEqual((await call('GET', '/files', { token: bob })).status, 401);
});

test('不能删除自己，也不能移除最后一个管理员', async () => {
  assert.strictEqual((await call('DELETE', '/users/admin', { token: admin })).status, 400);
  assert.strictEqual((await call('PUT', '/users/admin', { token: admin, body: { role: 'user', permissions: ['read'] } })).status, 400);
});

test('SFTP：chroot、权限、异常请求不会导致进程崩溃', async () => {
  const { conn, sftp } = await sftpConnect('bob', 'bob-pass-2');
  try {
    // 越界访问
    assert.ok((await p(cb => sftp.stat('/../admin-only.txt', cb))).err);
    assert.ok((await p(cb => sftp.open('/link/secret.txt', 'r', cb))).err, 'junction escape');
    // 目录句柄上 READ —— 旧代码会抛出未捕获异常使整个服务崩溃
    const dir = await p(cb => sftp.opendir('/', cb));
    assert.ifError(dir.err);
    const bad = await p(cb => sftp.read(dir.res, Buffer.alloc(10), 0, 10, 0, cb));
    assert.ok(bad.err);
    // 无 delete 权限
    assert.ok((await p(cb => sftp.unlink('/evil.txt', cb))).err);
    // 重命名不能覆盖
    await p(cb => sftp.writeFile('/b.txt', 'b', cb));
    assert.ok((await p(cb => sftp.rename('/b.txt', '/evil.txt', cb))).err);
    // 正常读写仍然可用
    assert.ifError((await p(cb => sftp.writeFile('/ok.txt', 'hello', cb))).err);
    assert.strictEqual(String((await p(cb => sftp.readFile('/ok.txt', cb))).res), 'hello');
  } finally {
    conn.end();
  }
  // 服务仍然存活
  assert.strictEqual((await call('GET', '/setup/status')).status, 200);
});

test('SFTP：无 read 权限不能读取文件；用户被修改后会话被踢出', async () => {
  await call('POST', '/users', { token: admin, body: { username: 'wo', password: 'wo-pass', homeDir: '/bob', permissions: ['write'] } });
  const { conn, sftp } = await sftpConnect('wo', 'wo-pass');
  const closed = new Promise(r => conn.on('close', r));
  assert.ok((await p(cb => sftp.readFile('/ok.txt', cb))).err);
  await call('PUT', '/users/wo', { token: admin, body: { enabled: false } });
  await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('not kicked')), 3000))]);
});

test('登录失败次数过多被限流', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } });
  assert.strictEqual(last.status, 429);
});
