# SFTP 工具 — 服务端设计文档

## 1. 项目概述

基于本地局域网的 SFTP 文件传输工具，服务端提供两大核心能力：
1. **SFTP 协议服务** — 基于 SSH2 协议，支持任意标准 SFTP 客户端连接
2. **Web API 服务** — 基于 REST 接口，为配套 Web 客户端提供文件管理能力

## 2. 技术选型

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Node.js | ≥ 18 LTS | 异步 I/O，适合文件传输场景 |
| SFTP 协议 | ssh2 | ^1.16.0 | 纯 JS 实现 SSH2/SFTP 服务端 |
| Web 框架 | Express | ^4.21.0 | 轻量、成熟的 REST API 框架 |
| 文件上传 | Multer | ^1.4.5 | Express 文件上传中间件 |
| 认证 | jsonwebtoken | ^9.0.0 | JWT Token 认证 |
| 密码加密 | bcryptjs | ^2.4.3 | 用户密码哈希 |
| 跨域 | cors | ^2.8.5 | CORS 中间件 |
| 配置 | dotenv | ^16.4.0 | 环境变量管理 |
| 日志 | winston | ^3.14.0 | 结构化日志 |
| SSH 密钥 | ssh-keygen (内置生成) | — | 自动生成服务端 Host Key |

## 3. 系统架构

```
┌──────────────────────────────────────────────────┐
│                  SFTP Server (Node.js)            │
│                                                    │
│  ┌─────────────────┐    ┌──────────────────────┐  │
│  │  SSH2 SFTP 服务  │    │   Express Web API    │  │
│  │  Port: 2222      │    │   Port: 3000         │  │
│  │                   │    │                      │  │
│  │  ● 用户认证      │    │  ● JWT 认证          │  │
│  │  ● 文件上传/下载 │    │  ● 文件 CRUD         │  │
│  │  ● 目录操作      │    │  ● 用户管理          │  │
│  │  ● 权限控制      │    │  ● 服务状态监控      │  │
│  └────────┬─────────┘    └──────────┬───────────┘  │
│           │                          │              │
│           └──────────┬───────────────┘              │
│                      │                              │
│           ┌──────────▼──────────┐                   │
│           │   共享文件存储根目录  │                   │
│           │   ./sftp-root/       │                   │
│           └─────────────────────┘                   │
│                                                    │
│           ┌─────────────────────┐                   │
│           │   用户数据 (JSON)    │                   │
│           │   ./data/users.json  │                   │
│           └─────────────────────┘                   │
└──────────────────────────────────────────────────┘
```

## 4. 目录结构

```
server/
├── src/
│   ├── index.js              # 入口，启动 SFTP + Web 服务
│   ├── sftp-server.js        # SSH2 SFTP 服务实现
│   ├── web-server.js         # Express Web API
│   ├── auth.js               # 认证模块 (JWT + 密码校验)
│   ├── user-manager.js       # 用户管理 (CRUD)
│   ├── file-service.js       # 文件操作服务层
│   └── logger.js             # 日志模块
├── data/
│   └── users.json            # 用户数据存储
├── sftp-root/                # SFTP 文件根目录
├── host-keys/                # SSH Host Key 自动生成
├── .env                      # 环境变量配置
├── package.json
└── README.md
```

## 5. 数据模型

### 5.1 用户模型 (users.json)

```json
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "$2a$10$...",
      "role": "admin",
      "homeDir": "/",
      "permissions": ["read", "write", "delete", "admin"],
      "createdAt": "2026-04-08T00:00:00Z",
      "enabled": true
    }
  ]
}
```

### 5.2 权限模型

| 权限 | 说明 |
|------|------|
| read | 读取/下载文件，列出目录 |
| write | 上传文件，创建目录 |
| delete | 删除文件/目录 |
| admin | 管理用户，查看系统状态 |

## 6. API 设计

### 6.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录，返回 JWT |

### 6.2 文件操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/files?path=/ | 列出目录内容 |
| GET | /api/files/download?path=/a.txt | 下载文件 |
| POST | /api/files/upload | 上传文件 (multipart) |
| POST | /api/files/mkdir | 创建目录 |
| DELETE | /api/files?path=/a.txt | 删除文件/目录 |
| PUT | /api/files/rename | 重命名/移动文件 |
| GET | /api/files/stat?path=/a.txt | 获取文件元信息 |

### 6.3 用户管理 (管理员)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/users | 用户列表 |
| POST | /api/users | 创建用户 |
| PUT | /api/users/:username | 修改用户 |
| DELETE | /api/users/:username | 删除用户 |

### 6.4 系统状态

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/status | 服务器状态 (连接数、磁盘使用等) |

## 7. SFTP 服务功能

- 支持密码认证
- 支持标准 SFTP 操作：OPEN、READ、WRITE、CLOSE、STAT、LSTAT、FSTAT、OPENDIR、READDIR、REMOVE、MKDIR、RMDIR、RENAME、REALPATH
- READDIR 返回 `.` 和 `..` 目录项，兼容 FileZilla / WinSCP 等客户端
- REALPATH 返回标准绝对虚拟路径（`/` 开头），解决部分客户端 `pwd` 失败问题
- SETSTAT / FSETSTAT 静默返回 OK（上传后时间戳设置不报错）
- READLINK / SYMLINK 返回 OP_UNSUPPORTED（明确告知不支持符号链接）
- EXTENDED 扩展请求（如 `statvfs@openssh.com`）返回 OP_UNSUPPORTED
- 文件句柄 per-session 独立管理，无多连接 handle 碰撞
- 会话断开时自动释放所有文件描述符，无泄漏
- OPEN 写模式自动创建父目录（支持深层路径文件上传）
- 用户登录后 chroot 到各自 homeDir，相互隔离
- 根据用户 permissions 控制读/写/删除

## 8. 安全设计

1. **密码加密** — bcrypt 单向哈希存储，salt rounds = 10
2. **JWT 签名** — HS256，Token 有效期 24h，payload 含 `{ username, role, permissions, homeDir }`，密钥通过环境变量配置
3. **路径安全** — 所有文件路径做 path traversal 防护：strip 前导 `/` 后 join homeDir，再做边界检查，防止 `/../` 逃逸
4. **中文文件名** — multer 以 latin1 解码 originalname，上传时统一 `Buffer.from(name,'latin1').toString('utf8')` 修正
5. **CORS** — `origin: true`（接受所有来源）+ credentials，适合局域网场景
6. **安全响应头** — `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`X-XSS-Protection: 1; mode=block`
7. **Host Key** — 首次启动自动生成 RSA 2048 密钥对，存储于 `host-keys/host_rsa`（权限 0o600）

## 9. 配置项 (.env)

```env
# SFTP 服务
SFTP_PORT=2222
SFTP_HOST=0.0.0.0

# Web API 服务
WEB_PORT=3000
WEB_HOST=0.0.0.0

# JWT
JWT_SECRET=your-secret-key-change-in-production

# 文件存储
SFTP_ROOT=./sftp-root

# 默认管理员 (首次启动自动创建)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

## 10. 启动流程

1. 加载环境变量
2. 初始化日志模块
3. 加载或自动生成 SSH Host Key
4. 加载用户数据，若无则创建默认管理员
5. 启动 SFTP 服务（监听 `SFTP_PORT`）
6. 启动 Web API 服务（监听 `WEB_PORT`）
7. 输出服务启动信息（IP、端口等）
