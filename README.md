# Local SFTP Tool

基于局域网的 SFTP 文件传输工具，包含 SFTP 协议服务端、REST API 和 Vue 3 Web 管理客户端。

> **打包为 macOS App**：见 [docs/build-mac.md](docs/build-mac.md)

## 架构

```
server/  — Node.js 服务端 (SFTP 协议 + Express REST API)
client/  — Vue 3 Web 客户端
docs/    — 设计文档
```

## 快速启动

### 1. 启动服务端

```bash
cd server
npm install
npm start
```

服务启动后：
- **SFTP 服务**: `sftp://0.0.0.0:2222`
- **Web API**: `http://0.0.0.0:3000`

默认管理员账号: `admin` / `admin123`（可在 `.env` 中修改）

### 2. 启动客户端（开发模式）

```bash
cd client
npm install
npm run dev
```

浏览器访问 `http://localhost:8080`（局域网其他设备用 `http://<本机IP>:8080`）

### 3. 生产部署

```bash
# 构建前端
cd client
npm run build

# 启动服务端（会自动托管 client/dist 静态文件）
cd ../server
npm start
```

生产模式下直接访问 `http://<server-ip>:3000`

## 使用 SFTP 客户端连接

```bash
# 使用系统 sftp 命令
sftp -P 2222 admin@<server-ip>

# 使用 FileZilla / WinSCP 等客户端
# 协议: SFTP
# 主机: <server-ip>
# 端口: 2222
# 用户名: admin
# 密码: admin123
```

> 连接成功后从 Web 页面"系统状态"页可一键复制 SFTP 命令。

## 配置项

编辑 `server/.env`：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| SFTP_PORT | 2222 | SFTP 协议端口 |
| WEB_PORT | 3000 | Web API 端口 |
| JWT_SECRET | (内置) | JWT 签名密钥 |
| SFTP_ROOT | ./sftp-root | 文件存储根目录 |
| ADMIN_USERNAME | admin | 默认管理员用户名 |
| ADMIN_PASSWORD | admin123 | 默认管理员密码 |

## 功能

### 文件管理
- 目录浏览，面包屑导航，快速跳转
- 文件名实时过滤搜索
- 上传：按钮多文件选择 + 区域拖拽上传
- 下载
- 新建文件夹
- 重命名
- 删除（二次确认）
- 拖拽移动（将文件/目录拖入另一个文件夹）
- 移动到上级目录
- 在线预览：Markdown 渲染、纯文本、图片（jpg/png/gif/webp/svg/bmp）
- 在线编辑：txt/md/json/js/ts/css/html/xml/yaml/sh/ini/conf 等文本格式，支持保存

### 用户管理（管理员）
- 用户列表、新建、编辑、删除
- 权限控制：read / write / delete / admin
- 角色选 admin 时自动勾选全部权限
- homeDir 可通过目录选择器设置，限制用户可见范围（chroot）
- 启用/禁用账户

### 系统状态
- 主机名、平台、端口信息
- 当前 SFTP 连接数、运行时长、内存占用
- 网络接口 IP 列表，一键复制 SFTP 连接命令

### SFTP 协议
- 兼容 FileZilla、WinSCP、系统 sftp 命令等标准客户端
- 支持密码认证
- 用户 chroot 到各自 homeDir，相互隔离
- 首次启动自动生成 RSA 2048 Host Key

### 安全
- 密码 bcrypt 哈希存储
- JWT 认证（24h 有效期）
- 路径遍历防护，服务端 chroot 强制边界
- 中文文件名正确处理（multer latin1 → utf-8）
