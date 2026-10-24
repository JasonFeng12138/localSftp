# SFTP 工具 — 服务端设计文档

## 1. 项目概述

基于本地局域网的 SFTP 文件传输工具，服务端提供两大核心能力：
1. **SFTP 协议服务**：基于 SSH2 协议，支持任意标准 SFTP 客户端连接
2. **Web 服务**：REST API + 托管 Web 客户端静态文件

两者共享同一套用户库、权限模型和路径解析逻辑（`FileService.resolvePath`）。

## 2. 技术选型

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Node.js | ≥ 18 | 使用内置 `node:test`、`fetch`、`crypto.randomUUID` |
| SFTP 协议 | ssh2 | ^1.16.0 | 纯 JS 实现的 SSH2/SFTP 服务端 |
| Web 框架 | Express | ^4.21.1 | REST API |
| 文件上传 | Multer | ^2.5.0 | multipart 上传中间件 |
| 认证 | jsonwebtoken | ^9.0.2 | JWT（HS256） |
| 密码加密 | bcryptjs | ^2.4.3 | 密码哈希，cost = 10 |
| 配置 | dotenv | ^16.4.7 | 读取 `.env` |
| 日志 | winston | ^3.14.2 | 控制台 + 滚动文件（5MB × 3） |

> 不使用 CORS 中间件：前端与 API 同源（生产由本服务托管，开发由 Vite 代理）。

## 3. 系统架构

```
┌───────────────────────────────────────────────────────────────┐
│                         Node.js 进程                           │
│                                                               │
│  ┌──────────────────────┐        ┌─────────────────────────┐  │
│  │   SftpServer (ssh2)  │        │   Express (web-server)  │  │
│  │   :2222              │        │   :3000                 │  │
│  │                      │        │  securityHeaders        │  │
│  │  密码认证 + 限流      │        │  routes/setup  auth     │  │
│  │  权限检查            │        │  routes/files  users    │  │
│  │  句柄管理            │        │  routes/system          │  │
│  └─────────┬────────────┘        │  统一错误处理（脱敏）    │  │
│            │                     └────────────┬────────────┘  │
│            │   ┌──────────────┐               │               │
│            ├──▶│ LoginLimiter │◀──────────────┤               │
│            │   └──────────────┘               │               │
│            │   ┌──────────────┐  ┌─────────┐  │               │
│            ├──▶│ UserManager  │◀─│ auth.js │◀─┤               │
│            │   └──────┬───────┘  └─────────┘  │               │
│            │   ┌──────▼───────┐               │               │
│            └──▶│ FileService  │◀──────────────┘               │
│                │ resolvePath  │                               │
│                └──────┬───────┘                               │
└───────────────────────┼───────────────────────────────────────┘
                        ▼
      SFTP_ROOT（文件存储）     DATA_DIR / HOST_KEYS_DIR / LOGS_DIR
                                （程序内部数据，与存储根目录严格隔离）
```

## 4. 目录结构

```
server/
├── src/
│   ├── index.js            # 入口：加载配置、创建默认管理员、启动 SFTP + Web；导出 main 供 Electron 调用
│   ├── config.js           # 路径配置、settings.json、JWT 密钥、存储根目录校验、原子写文件
│   ├── errors.js           # ClientError / PathError 及错误脱敏 toClientError
│   ├── utils.js            # isWithin、sameFile、本机请求判断、局域网地址、asyncRoute 等
│   ├── rate-limiter.js     # 登录失败限流（Web 与 SFTP 共用单例）
│   ├── logger.js           # winston 日志
│   ├── auth.js             # createAuth：签发/校验 Token、会话跟踪与吊销、权限中间件
│   ├── user-manager.js     # 用户 CRUD、输入校验、角色/权限规范化、tokenVersion
│   ├── file-service.js     # 虚拟路径解析（chroot + 符号链接检查）与文件操作
│   ├── sftp-server.js      # SSH2 SFTP 服务实现
│   ├── web-server.js       # Express 应用组装：安全头、路由挂载、404、错误处理
│   └── routes/
│       ├── setup.js        # /api/setup    首次初始化（仅本机）
│       ├── auth.js         # /api/auth     登录 / 退出
│       ├── files.js        # /api/files    文件操作
│       ├── users.js        # /api/users    用户管理（管理员）
│       └── system.js       # /api/status、/api/connections、/api/settings
├── test/
│   └── security.test.js    # 安全回归测试（npm test）
├── data/                   # DATA_DIR（运行时生成，勿提交）
│   ├── users.json          # 用户库
│   ├── settings.json       # 持久化设置（如 sftpRoot）
│   └── jwt-secret          # 自动生成的 JWT 密钥
├── host-keys/host_rsa      # SSH 主机私钥（自动生成）
├── logs/server.log         # 运行日志
├── sftp-root/              # 默认文件存储根目录
├── .env.example
└── package.json
```

各路由模块统一导出 `function (deps) → express.Router`，`deps = { userManager, fileService, sftpServer, auth }`，由 `web-server.js` 注入，便于测试和替换。

## 5. 数据模型

### 5.1 用户（`data/users.json`）

```json
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "$2a$10$...",
      "role": "admin",
      "permissions": ["read", "write", "delete", "admin"],
      "homeDir": "/",
      "createdAt": "2026-10-23T00:00:00.000Z",
      "enabled": true,
      "tokenVersion": 0
    }
  ]
}
```

| 字段 | 约束 |
|------|------|
| `username` | `^[\p{L}\p{N}_.@-]{1,32}$`（字母/数字含中文、`_ . @ -`），创建后不可修改 |
| 密码 | 6–128 位 |
| `role` | `admin` \| `user` |
| `permissions` | 见 5.2，由服务端规范化 |
| `homeDir` | 相对存储根目录的虚拟路径，规范为 `/a/b`；禁止 `.`、`..`、`:`、NUL |
| `tokenVersion` | 改密或禁用时 +1，使该用户已签发的全部 Token 失效；不对外返回 |

对外返回用户信息时会去掉 `passwordHash` 和 `tokenVersion`。写入采用「临时文件 + rename」的原子方式，文件权限 `0600`。

### 5.2 权限模型

| 权限 | Web | SFTP |
|------|-----|------|
| `read` | 列目录、查看元信息、下载 | OPEN（读）、OPENDIR/READDIR |
| `write` | 上传、新建目录、重命名/移动 | OPEN（写/创建）、MKDIR、RENAME |
| `delete` | 删除文件/目录（递归） | REMOVE、RMDIR |
| `admin` | 用户管理、连接管理、修改设置 | — |

规范化规则（`normalizeAccess`）：
- `role = admin` ⇒ 权限固定为全部四项
- `role = user` ⇒ 不能持有 `admin` 权限
- 没有 `read` 时自动去掉 `write` / `delete`

保护规则：
- 至少保留一个启用状态的管理员，最后一个管理员不能被删除、降级或禁用
- 管理员不能删除自己

## 6. 认证与会话

- **登录**：`verifyPassword` 在用户不存在时也会与一个固定的假哈希做比对，使响应时间一致，防止枚举用户名。
- **Token**：HS256，有效期 24h，payload 只有 `{ sub: 用户名, sid: 会话 UUID, tv: tokenVersion }`。
- **每次请求的校验**（`authenticate`）：
  1. 校验签名，且只允许 HS256
  2. 按 `sub` 重新读取用户
  3. 用户不存在、已禁用、`tv` 与当前 `tokenVersion` 不一致、或 `sid` 已吊销 ⇒ 返回 401
  4. 从用户库**实时**取出 `role`、`permissions`、`homeDir`，挂到 `req.user`
- **会话**：在线 Web 会话按 `sid` 记录（10 分钟无活动后移出列表），管理员可按 `sid` 精确踢出。退出登录接口会吊销当前 `sid`。吊销记录在 Token 过期后自动清理。
- **JWT 密钥**（`getJwtSecret`）：环境变量 `JWT_SECRET` ≥ 32 字符且不是已知示例值时才使用；否则读取或生成 `DATA_DIR/jwt-secret`（48 字节随机数）。
- **限流**（`rate-limiter.js`），15 分钟窗口内：
  - 同一「IP + 用户名」失败 5 次即锁定
  - 同一 IP 累计失败 30 次即锁定
  - Web 登录与 SFTP 密码认证共用同一计数

> 吊销列表和在线会话保存在内存中，重启服务后丢失。但 `tokenVersion` 是持久化的，因此改密、禁用的效果不受重启影响。

## 7. 路径解析（chroot）

所有对文件系统的访问都必须经过 `FileService.resolvePath(virtualPath, homeDir, { allowHome })`：

1. 拒绝含 NUL 的路径；Windows 下拒绝含 `:` 的路径（防盘符、ADS）
2. `home = root + homeDir`，必须位于存储根目录内
3. `target = resolve(home, '.' + virtualPath)`，按字面检查 `target` 是否在 `home` 内（`isWithin`，基于 `path.relative`）
4. `allowHome: false` 时，`target` 不能等于 `home` 本身。删除、重命名、SFTP 的 OPEN/MKDIR 都使用此模式，防止误删整个主目录
5. **真实路径检查**：取 `target` 最近的已存在祖先目录做 `realpath`，确认仍位于真实的 home 内，防止借符号链接或 Windows 目录联接（junction）逃出存储根目录

其他文件操作规则：
- **上传**：文件名先从 latin1 转回 UTF-8，再取 basename，并拒绝 `.`、`..`；跨盘移动（EXDEV）时回退为复制 + 删除
- **重命名**：目标已存在时返回 409。例外是两者为同一文件（`sameFile` 比较 dev/ino），以支持只改大小写的重命名

### 存储根目录校验（`validateSftpRoot`）

以下情况拒绝：
- 非绝对路径
- 磁盘根（`/`、`C:\`）
- 位于系统目录内：
  - `/etc`、`/usr`、`/bin`、`/System`、`/Library` 等
  - Windows 下的 `SystemRoot`、`ProgramFiles`、`ProgramData`
- 与 `DATA_DIR`、`HOST_KEYS_DIR`、`LOGS_DIR` **互相包含**

启动时和 `PUT /api/settings` 时都会执行此校验。

## 8. API

完整的请求、响应说明见 [api.md](api.md)。概览：

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/setup/status` | 公开 | 是否需要初始化 |
| POST | `/api/setup/complete` | 未初始化 + 本机 | 创建首个管理员，可选设置存储目录 |
| GET | `/api/setup/dirs` | 未初始化 + 本机 | 浏览当前用户家目录下的文件夹 |
| POST | `/api/auth/login` | 公开（限流） | 登录 |
| POST | `/api/auth/logout` | 登录 | 吊销当前 Token |
| GET | `/api/files` | read | 列目录 |
| GET | `/api/files/stat` | read | 元信息 |
| GET | `/api/files/download` | read | 下载 |
| POST | `/api/files/upload` | write | 上传（同名覆盖） |
| POST | `/api/files/mkdir` | write | 新建目录 |
| PUT | `/api/files/rename` | write | 重命名/移动（不覆盖） |
| DELETE | `/api/files` | delete | 删除 |
| GET/POST | `/api/users` | admin | 用户列表 / 创建 |
| PUT/DELETE | `/api/users/:username` | admin | 修改 / 删除 |
| GET | `/api/status` | 登录 | 状态（非管理员只返回基础字段） |
| GET | `/api/connections` | admin | 局域网地址、SFTP 连接、Web 会话 |
| DELETE | `/api/connections/web/:sessionKey` | admin | 踢出 Web 会话 |
| DELETE | `/api/connections/:connId` | admin | 踢出 SFTP 连接 |
| PUT | `/api/settings` | admin | 修改存储根目录 |
| GET | `/api/settings/dirs` | admin | 浏览当前用户家目录下的文件夹 |

未匹配的 `/api/*` 返回 404 JSON；其他路径回退到 `client/dist/index.html`（SPA）。

## 9. SFTP 服务

- **认证**：
  - 仅支持密码认证，并经过登录限流
  - 认证时使用的是当时的用户快照；用户被修改或删除后，服务端调用 `kickUser` 断开该用户的所有连接，客户端须按新设置重新登录
- **支持的操作**：OPEN、READ、WRITE、CLOSE、STAT、LSTAT、FSTAT、OPENDIR、READDIR、REMOVE、RMDIR、MKDIR、RENAME、REALPATH
- **权限检查**：
  - OPEN 分别判断读意图和写意图，WRITE/APPEND/CREAT/TRUNC 中任一位都视为写
  - 打开模式通过 `toFsFlags` 映射为数值型的 `fs.constants`
- **资源上限**：
  - 单次 READ 最多 256KB，防止客户端请求超大长度耗尽内存
  - READDIR 每批返回 100 项，第一批额外附带 `.` 和 `..`
- **健壮性**：
  - 所有请求处理函数都经 `on()` 包装：任何异常都转为 SFTP 状态码返回（ENOENT → NO_SUCH_FILE，EACCES/EPERM/PathError → PERMISSION_DENIED，其他 → FAILURE），不会让进程崩溃
  - 在目录句柄上 READ、使用无效句柄等异常请求都会返回错误
- **句柄**：每个会话独立管理，会话结束时释放全部 fd
- **RENAME**：目标已存在时返回失败，防止只有 write 权限的用户借重命名覆盖（相当于删除）文件
- **REALPATH**：返回以 `/` 开头的虚拟路径，兼容各客户端的 `pwd`
- **SETSTAT / FSETSTAT**：直接返回 OK，但不执行 chmod 或 chown，避免客户端上传后设置时间戳时报错
- **不支持的操作**：READLINK、SYMLINK、EXTENDED 返回 OP_UNSUPPORTED
- **主机密钥**：
  - 首次启动时生成 RSA 3072 密钥，保存为 `HOST_KEYS_DIR/host_rsa`（权限 0600）
  - 已存在的密钥不会被替换，避免客户端出现主机指纹变更告警
- **连接 ID**：使用随机 UUID，管理员可按 ID 踢出连接

## 10. Web 服务

- **中间件顺序**：
  1. `securityHeaders`
  2. `express.json`（上限 100kb）
  3. 静态文件
  4. 各路由
  5. `/api` 404
  6. SPA fallback
  7. 错误处理
- **安全响应头**：
  - CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; …; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `/api/*` 响应附加 `Cache-Control: no-store`
- **query 解析**：使用 `'simple'` 模式（Node 内置 querystring）。接口只需要扁平参数，这样也规避了 `qs` 的解析类 DoS 漏洞
- **上传限制**：
  - Multer 先把文件写入系统临时目录，再由 `FileService` 移动到目标位置；请求结束时（`finally`）清理临时文件
  - 每次请求最多 1 个文件、5 个字段；单文件大小上限由 `MAX_UPLOAD_MB` 设置
- **错误处理**：
  - `ClientError` 原样返回
  - fs 错误码映射为中文提示（如 ENOENT → 404「文件或目录不存在」）
  - 其他错误一律返回 500「服务器内部错误」，堆栈只写入日志
  - 响应中不会出现服务器的绝对路径
- **审计日志**：上传、删除、重命名、用户变更、踢出连接都会记录操作者。路径经 `JSON.stringify` 转义，防止伪造日志行

## 11. 启动流程

1. `dotenv` 加载 `.env`（不会覆盖已存在的环境变量，Electron 借此注入路径）
2. 读取 `settings.json`，确定存储根目录（`settings.sftpRoot` > `SFTP_ROOT` > `./sftp-root`），并执行 `validateSftpRoot`
3. 加载用户库。没有用户且未设置 `SKIP_DEFAULT_ADMIN` 时创建默认管理员：
   - 未设置 `ADMIN_PASSWORD` 时随机生成密码，只打印到控制台
4. 加载或生成主机密钥，启动 SFTP 服务
5. 获取 JWT 密钥，组装 Express 应用并监听 `WEB_PORT`

`index.js` 被直接运行时会自动启动；被 `require` 时导出 `main()`，供 Electron 和测试调用。

## 12. 测试

```bash
cd server && npm test
```

`test/security.test.js` 在临时目录中启动完整服务，覆盖以下场景：
- 伪造 Token、安全响应头、初始化接口锁定
- 输入校验与批量赋值
- 路径穿越与 junction 逃逸、上传文件名穿越
- 根目录保护、重命名覆盖、状态信息脱敏、存储目录校验
- Token 吊销与权限即时生效、最后一个管理员保护
- SFTP 的 chroot、权限、畸形请求、会话踢出
- 登录限流
