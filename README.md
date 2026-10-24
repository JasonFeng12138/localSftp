# Local SFTP Tool

基于局域网的 SFTP 文件传输工具，包含 SFTP 协议服务端、REST API 和 Vue 3 Web 管理客户端，并可打包为 macOS 桌面 App。

## 文档

| 文档 | 内容 |
|------|------|
| [docs/server-design.md](docs/server-design.md) | 服务端架构、模块划分、数据模型、SFTP 实现 |
| [docs/api.md](docs/api.md) | REST API 参考（请求、响应、权限、错误码） |
| [docs/client-design.md](docs/client-design.md) | Web 客户端结构、路由、状态管理、交互设计 |
| [docs/security.md](docs/security.md) | 安全模型、防护措施、部署加固清单、已知限制 |
| [docs/build-mac.md](docs/build-mac.md) | 打包为 macOS App |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

## 目录结构

```
server/    — Node.js 服务端（SFTP 协议 + Express REST API）
client/    — Vue 3 Web 客户端
electron/  — Electron 桌面壳（内嵌服务端）
scripts/   — 打包脚本
docs/      — 设计文档
```

## 快速启动

环境要求：Node.js ≥ 18。

### 1. 启动服务端

```bash
cd server
npm install
cp .env.example .env   # 按需修改，见下方「配置项」
npm start
```

服务启动后：
- **SFTP 服务**：`sftp://<本机IP>:2222`
- **Web 服务**：`http://<本机IP>:3000`

**首次启动的管理员账号**（仅在没有任何用户时创建）：
- 用户名取 `ADMIN_USERNAME`（默认 `admin`）
- 密码取 `ADMIN_PASSWORD`；**未设置时会随机生成，并只在控制台打印一次**（不写入日志文件），请记下后登录修改

```
  初始管理员: admin
  初始密码:   xxxxxxxxxxxxxxxx
```

> 设置环境变量 `SKIP_DEFAULT_ADMIN=true` 可跳过自动创建，改为在**本机**浏览器打开 Web 页面，通过初始化向导创建管理员（Electron 版即采用此方式）。

### 2. 启动客户端（开发模式）

```bash
cd client
npm install
npm run dev
```

浏览器访问 `http://localhost:8080`，`/api` 请求由 Vite 代理到 `http://localhost:3000`。

> ⚠️ 开发服务器监听 `0.0.0.0`，且经过代理后服务端看到的来源均为本机。开发模式下请勿在不可信网络中保持「未初始化」状态。

### 3. 生产部署

```bash
cd client && npm install && npm run build   # 产物在 client/dist
cd ../server && npm install --omit=dev && npm start
```

服务端会自动托管 `client/dist`，直接访问 `http://<server-ip>:3000`。

### 4. 运行安全回归测试

```bash
cd server
npm test
```

测试会在系统临时目录中启动一套完整的 Web + SFTP 服务，以攻击者视角验证越权、路径穿越、Token 吊销、限流等防护。

## 使用 SFTP 客户端连接

```bash
sftp -P 2222 <用户名>@<server-ip>
```

FileZilla / WinSCP 等图形客户端：协议选 **SFTP**，端口 `2222`，使用 Web 端创建的用户名和密码。

> 「系统状态」页可一键复制 SFTP 命令；管理员可在「快速连接」页扫码访问、查看/踢出在线连接。

## 配置项

编辑 `server/.env`（模板见 [server/.env.example](server/.env.example)）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SFTP_PORT` | `2222` | SFTP 协议端口 |
| `SFTP_HOST` | `0.0.0.0` | SFTP 监听地址 |
| `WEB_PORT` | `3000` | Web 服务端口 |
| `WEB_HOST` | `0.0.0.0` | Web 监听地址 |
| `JWT_SECRET` | *(自动生成)* | JWT 签名密钥。须 ≥ 32 字符；留空或使用示例值时自动生成随机密钥并保存到 `data/jwt-secret` |
| `SFTP_ROOT` | `./sftp-root` | 文件存储根目录。不能是磁盘根、系统目录，也不能与数据/密钥/日志目录互相包含 |
| `ADMIN_USERNAME` | `admin` | 首次启动创建的管理员用户名 |
| `ADMIN_PASSWORD` | *(随机生成)* | 首次启动创建的管理员密码（≥ 6 位） |
| `MAX_UPLOAD_MB` | *(不限)* | Web 单文件上传大小上限（MB） |
| `DATA_DIR` | `server/data` | 用户库、设置、JWT 密钥存放目录 |
| `HOST_KEYS_DIR` | `server/host-keys` | SSH 主机密钥目录 |
| `LOGS_DIR` | `server/logs` | 日志目录 |
| `SKIP_DEFAULT_ADMIN` | *(空)* | 非空时不自动创建管理员，改用初始化向导 |

> 在 Web「系统状态」页修改的存储目录会持久化到 `data/settings.json`，优先级高于 `SFTP_ROOT`。

## 功能

### 文件管理
- 目录浏览、面包屑导航、文件名实时过滤
- 上传（多文件选择 / 拖拽）、下载、新建文件夹、重命名、删除（二次确认）
- 拖拽移动到其他文件夹、移动到上级目录
- 在线预览：Markdown（经 DOMPurify 净化）、纯文本、日志、图片（jpg/png/gif/webp/svg/bmp）
- 在线编辑：txt/md/json/js/ts/css/html/xml/yaml/yml/sh/env/ini/conf

### 用户管理（管理员）
- 用户增删改、启用/禁用
- 角色 `admin` / `user`；权限 `read` / `write` / `delete`（`admin` 角色自动拥有全部权限）
- 通过目录选择器设置 homeDir，用户被限制在该目录内（chroot）
- 修改用户后，其已有的 Web 登录与 SFTP 会话立即按新设置生效

### 系统状态 / 快速连接
- 所有用户：端口、运行时长、局域网 IP、复制 SFTP 命令
- 管理员额外可见：主机名、平台、内存、SFTP 连接数、存储目录（可修改）
- 快速连接（管理员）：访问地址二维码、在线 SFTP 连接与 Web 会话列表，支持踢出

### SFTP 协议
- 兼容 FileZilla、WinSCP、系统 `sftp` 命令等标准客户端
- 密码认证，用户 chroot 到各自 homeDir
- 按 read / write / delete 权限控制每个操作
- 首次启动自动生成 RSA 3072 主机密钥

### 安全
- bcrypt 密码哈希；JWT 仅携带身份，权限每次请求实时读取
- 改密、禁用、退出登录后旧 Token 立即失效
- Web 与 SFTP 登录失败限流
- 路径穿越与符号链接逃逸防护
- 初始化接口仅限本机访问
- CSP 等安全响应头，错误信息脱敏

详见 [docs/security.md](docs/security.md)。
