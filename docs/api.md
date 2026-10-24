# REST API 参考

## 通用约定

- **Base URL**：`http://<host>:<WEB_PORT>/api`，前端同源访问
- **认证**：除特别说明外，所有接口都需要请求头 `Authorization: Bearer <token>`
- **请求体**：`application/json`，上限 100KB；上传接口使用 `multipart/form-data`
- **路径参数**：所有文件路径都是**相对当前用户 homeDir 的虚拟路径**，以 `/` 开头，例如 `/docs/a.txt`
- **错误响应**：统一为 `{ "error": "说明" }`，不会包含服务器绝对路径或堆栈

| 状态码 | 含义 |
|--------|------|
| 400 | 参数错误、校验失败 |
| 401 | 未登录，或 Token 无效、过期、已吊销（用户被禁用、改密、退出登录） |
| 403 | 权限不足、路径越界、初始化接口被锁定 |
| 404 | 文件、用户、会话不存在，或 API 路由不存在 |
| 409 | 目标已存在、目录非空、文件被占用、初始化进行中 |
| 429 | 登录失败次数过多 |
| 500 | 服务器内部错误（详情只记录在日志中） |

---

## 1. 初始化 `/api/setup`

仅在**没有任何用户**时可用。除 `GET /status` 外，其余接口只接受**本机**请求，即 Host 为 `localhost`、`127.0.0.1` 或 `[::1]`，且来源 IP 为回环地址。初始化完成后，这些接口一律返回 403。

### GET /api/setup/status
公开接口，无需认证。

```json
{ "needSetup": true }
```

### POST /api/setup/complete
创建首个管理员，可同时设置存储目录。

```json
{ "username": "admin", "password": "******", "sftpRoot": "/Users/me/SFTP" }
```

- `sftpRoot` 可选，须通过存储目录校验（见 [security.md](security.md)）
- 有并发请求时，后到的返回 409

响应：`{ "ok": true }`

### GET /api/setup/dirs?path=
列出当前操作系统用户家目录（或其子目录）下的文件夹，不含隐藏目录，供选择存储目录。`path` 为空时返回家目录本身；越出家目录则返回 403。

```json
{ "current": "/Users/me", "dirs": [{ "name": "Documents", "path": "/Users/me/Documents" }] }
```

---

## 2. 认证 `/api/auth`

### POST /api/auth/login
无需认证。受登录限流约束：同一「IP + 用户名」15 分钟内失败 5 次，或同一 IP 失败 30 次，即返回 429。

```json
{ "username": "alice", "password": "******" }
```

响应：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "username": "alice",
    "role": "user",
    "permissions": ["read", "write"],
    "homeDir": "/alice",
    "createdAt": "2026-10-23T08:00:00.000Z",
    "enabled": true
  }
}
```

Token 有效期 24 小时。用户名或密码错误、账号已禁用都统一返回 401 `Invalid credentials`。

### POST /api/auth/logout
吊销当前 Token。响应：`{ "ok": true }`

---

## 3. 文件 `/api/files`

| 接口 | 所需权限 |
|------|----------|
| GET `/api/files` | read |
| GET `/api/files/stat` | read |
| GET `/api/files/download` | read |
| POST `/api/files/upload` | write |
| POST `/api/files/mkdir` | write |
| PUT `/api/files/rename` | write |
| DELETE `/api/files` | delete |

### GET /api/files?path=/docs
列出目录。`path` 默认为 `/`。

```json
[
  { "name": "a.txt", "isDirectory": false, "size": 12, "mtime": "2026-10-23T08:00:00.000Z" },
  { "name": "img", "isDirectory": true, "size": 0, "mtime": "2026-10-23T08:00:00.000Z" }
]
```

### GET /api/files/stat?path=/docs/a.txt

```json
{ "name": "a.txt", "isDirectory": false, "size": 12, "mtime": "...", "atime": "...", "ctime": "..." }
```

### GET /api/files/download?path=/docs/a.txt
以附件形式返回文件内容。路径是目录或不存在时返回 404。

### POST /api/files/upload
`multipart/form-data` 字段如下：

| 字段 | 说明 |
|------|------|
| `file` | 文件，每次一个 |
| `path` | 目标目录，默认 `/` |

- 文件名只取 basename，`../` 等目录部分会被剥离
- 同名文件会被**覆盖**，在线编辑的保存依赖这一行为
- 文件超过 `MAX_UPLOAD_MB` 时返回 400

响应：`{ "success": true }`

### POST /api/files/mkdir

```json
{ "path": "/docs/new-folder" }
```

会递归创建。响应：`{ "success": true }`

### PUT /api/files/rename
重命名或移动。

```json
{ "oldPath": "/docs/a.txt", "newPath": "/archive/a.txt" }
```

- 目标已存在时返回 409，不会覆盖（仅修改大小写除外）
- `oldPath` 和 `newPath` 都不能是 homeDir 本身（`/`）

### DELETE /api/files?path=/docs/a.txt
删除文件或目录（递归）。不能删除 `/`，即 homeDir 本身。响应：`{ "success": true }`

---

## 4. 用户 `/api/users`（管理员）

用户对象不会包含 `passwordHash` 和 `tokenVersion`。

### GET /api/users
返回用户对象数组。

### POST /api/users
服务端只接受以下字段，其余字段一律忽略：

```json
{
  "username": "alice",
  "password": "******",
  "role": "user",
  "homeDir": "/alice",
  "permissions": ["read", "write"]
}
```

| 字段 | 规则 |
|------|------|
| `username` | 1–32 位，可含字母、数字（包括中文）和 `_ . @ -`，必填 |
| `password` | 6–128 位，必填 |
| `role` | `admin` 或 `user`，默认 `user` |
| `homeDir` | 默认 `/`，不能包含 `..`、`:` |
| `permissions` | 取值为 `read`、`write`、`delete`，默认 `["read","write"]` |

`permissions` 会被服务端规范化：`admin` 角色自动获得全部权限，普通用户的 `admin` 权限会被去掉，没有 `read` 时 `write` 和 `delete` 也会被去掉。

响应为创建后的用户对象。

### PUT /api/users/:username
可修改的字段只有 `password`、`role`、`homeDir`、`permissions`、`enabled`，传哪个改哪个。

- 修改密码或禁用账号后，该用户所有已签发的 Token 立即失效
- 任何修改都会断开该用户现有的 SFTP 连接
- 如果修改会导致系统中没有启用状态的管理员，返回 400

### DELETE /api/users/:username
以下两种情况返回 400：删除自己；删除最后一个启用状态的管理员。删除后会断开该用户的 SFTP 连接。

响应：`{ "success": true }`

---

## 5. 系统 `/api`

### GET /api/status
所有登录用户都可以调用。

普通用户收到的响应：

```json
{
  "sftpPort": 2222,
  "webPort": 3000,
  "uptime": 3600,
  "networkInterfaces": [{ "name": "en0", "address": "192.168.1.10" }]
}
```

管理员在此基础上还会收到 `sftpConnections`（连接数）、`platform`、`hostname`、`memoryUsage`（RSS 字节数）、`sftpRoot`（绝对路径）。

### GET /api/connections（管理员）

```json
{
  "webPort": 3000,
  "sftpPort": 2222,
  "lanAddresses": ["192.168.1.10"],
  "sftpConnections": [
    { "connId": "uuid", "ip": "192.168.1.20", "username": "alice", "connectedAt": "..." }
  ],
  "webSessions": [
    { "sessionKey": "uuid", "username": "alice", "role": "user", "ip": "192.168.1.20",
      "lastSeen": "...", "userAgent": "Mozilla/5.0 ..." }
  ]
}
```

`webSessions` 只列出最近 10 分钟内有过请求的会话。

### DELETE /api/connections/web/:sessionKey（管理员）
吊销指定的 Web 会话 Token。会话不存在时返回 404。

### DELETE /api/connections/:connId（管理员）
断开指定的 SFTP 连接。连接不存在时返回 404。

### PUT /api/settings（管理员）

```json
{ "sftpRoot": "/Users/me/SFTP" }
```

修改存储根目录。目录会被校验、自动创建，并检查读写权限，最后持久化到 `data/settings.json`。

响应：`{ "sftpRoot": "<规范化后的绝对路径>" }`

### GET /api/settings/dirs?path=（管理员）
与 `/api/setup/dirs` 相同，只能浏览当前用户家目录。
