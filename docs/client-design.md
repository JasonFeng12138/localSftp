# SFTP 工具 — 客户端设计文档

## 1. 项目概述

这是一个基于 Vue 3 的 Web 管理客户端，通过 REST API 与服务端通信，提供以下功能：
- 首次初始化向导
- 文件浏览、上传、下载、在线预览和编辑
- 用户管理
- 系统状态与快速连接

生产环境下由服务端托管静态文件（同源访问），Electron 版直接在窗口中加载该页面。

## 2. 技术选型

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端框架 | Vue 3 | ^3.5 | Composition API + `<script setup>` |
| 构建工具 | Vite | ^6.4 | 开发服务器 + 构建 |
| UI 组件库 | Element Plus | ^2.9 | 组件与图标（@element-plus/icons-vue） |
| HTTP | Axios | ^1.7 | 统一实例与拦截器 |
| 路由 | Vue Router | ^4.5 | History 模式 |
| 状态管理 | Pinia | ^2.3 | 认证与文件列表状态 |
| Markdown | marked + DOMPurify | ^12 / ^3.4 | 渲染后必须经过净化 |
| 二维码 | qrcode | ^1.5 | 快速连接页的访问地址二维码 |

## 3. 目录结构

```
client/
├── src/
│   ├── main.js                 # 入口：注册 Pinia、Router、Element Plus
│   ├── App.vue                 # 根组件（路由出口）
│   ├── router/index.js         # 路由表 + 导航守卫（初始化检测、登录、管理员）
│   ├── stores/
│   │   ├── auth.js             # Token 与当前用户、权限计算属性
│   │   └── files.js            # 当前目录、文件列表、面包屑
│   ├── api/
│   │   ├── index.js            # Axios 实例（baseURL /api、30s 超时、401 处理）
│   │   ├── auth.js             # login / logout
│   │   ├── files.js            # 文件操作（上传/下载不设超时）
│   │   ├── users.js            # 用户管理（用户名经 encodeURIComponent 编码）
│   │   └── status.js           # 状态、连接、设置、初始化
│   ├── views/
│   │   ├── Setup.vue           # 首次初始化向导
│   │   ├── Login.vue           # 登录
│   │   ├── Layout.vue          # 主布局：侧边栏、顶栏、移动端导航、退出登录
│   │   ├── FileManager.vue     # 文件管理（核心页面）
│   │   ├── UserManager.vue     # 用户管理（管理员）
│   │   ├── ServerStatus.vue    # 系统状态 + 修改存储目录（管理员）
│   │   └── QuickConnect.vue    # 快速连接：二维码、在线连接/会话管理（管理员）
│   ├── components/
│   │   └── PageHeading.vue     # 页面标题区
│   ├── styles/theme.css        # 全局主题变量
│   └── utils/format.js         # formatSize / formatDate / formatUptime
├── index.html
├── vite.config.js
└── package.json
```

## 4. 路由

| 路径 | 组件 | 访问条件 |
|------|------|----------|
| `/setup` | Setup.vue | 系统未初始化 |
| `/login` | Login.vue | 公开 |
| `/` | FileManager.vue | 已登录 |
| `/users` | UserManager.vue | 管理员 |
| `/status` | ServerStatus.vue | 已登录 |
| `/connect` | QuickConnect.vue | 管理员 |

导航守卫（`router.beforeEach`）：
1. 应用启动后第一次导航时请求一次 `GET /api/setup/status`。如果需要初始化，就跳转到 `/setup`。结果会被缓存，初始化完成后调用 `resetSetupCheck()` 重置。
2. 访问需要登录的路由但未登录时，跳转到 `/login`。
3. 访问管理员路由但当前用户不是 admin 时，跳转到 `/`。

> 前端守卫和按钮隐藏只用于改善体验，**真正的权限控制由服务端执行**。即使修改 localStorage 里的 `role`，也无法调用管理员接口。

## 5. 认证流程

- **登录**：调用 `POST /api/auth/login` 后，`auth.setAuth(token, user)` 把 Token 和用户信息存入 localStorage（`sftp_token` / `sftp_user`）。
- **请求**：Axios 请求拦截器自动附加 `Authorization: Bearer <token>`。
- **失效**：任何接口返回 401 时（Token 过期、被管理员踢出、用户被禁用或改密），响应拦截器会清除本地状态并跳转到 `/login`。
- **退出**：`Layout.vue` 的 `handleLogout` 先调用 `POST /api/auth/logout`，让服务端吊销该 Token（请求失败时忽略），再清除本地状态。
- **权限变化**：用户信息在登录时缓存在本地。管理员修改权限后，服务端立即按新权限执行；前端界面要等重新登录后才会刷新按钮的显示状态。

## 6. 页面功能

### 6.1 初始化向导（Setup.vue）

分为三步：
1. **管理员账号**：填写用户名和密码。
2. **文件存储目录**：通过 `/api/setup/dirs` 浏览当前系统用户家目录下的文件夹。也可以输入一个新的文件夹名，提交初始化时由服务端创建该文件夹。
3. **完成**。

初始化只能在服务端所在机器上，通过 `localhost` 访问完成；从局域网其他设备访问会收到 403。

### 6.2 文件管理（FileManager.vue）

| 功能 | 说明 |
|------|------|
| 目录浏览 | 双击进入文件夹，点击面包屑可回到任意上级 |
| 过滤 | 实时过滤当前目录的文件名，切换目录后不清空 |
| 上传 | 按钮选择多个文件或拖拽到区域；显示进度；同名文件会被覆盖 |
| 下载 | 通过 Blob 下载 |
| 新建文件夹 / 重命名 | 弹窗输入；重命名的目标已存在时服务端返回 409 并提示 |
| 删除 | 二次确认后删除，目录递归删除 |
| 移动 | 把行拖入其他文件夹，或使用「移动到上级」 |
| 预览 | 支持文本、`.log`、Markdown 和图片（jpg/jpeg/png/gif/webp/svg/bmp） |
| 编辑 | 支持 txt/md/json/js/ts/css/html/xml/yaml/yml/sh/env/ini/conf；保存时重新上传覆盖原文件；有未保存内容时关闭弹窗会二次确认 |
| 权限驱动 UI | 根据 `canWrite` / `canDelete` 显示或隐藏操作按钮；没有写权限时禁止拖拽 |

**Markdown 安全**：渲染方式为 `DOMPurify.sanitize(marked.parse(content))`。文件内容来自任何有写权限的用户，不经净化直接用 `v-html` 渲染会造成存储型 XSS，可窃取管理员的 Token。新增任何 `v-html` 时都必须同样经过 DOMPurify 处理。

**图片预览**：图片以 Object URL 加载，关闭弹窗时调用 revoke 释放。

### 6.3 用户管理（UserManager.vue，管理员）

- 用户列表、新建、编辑（密码留空表示不修改）、启用/禁用、删除。
- 权限联动：
  - 取消 read 时自动取消 write 和 delete。
  - 选择 admin 角色时自动勾选全部权限。
  - 服务端会再执行一次相同的规范化。
- homeDir 选择器：通过 `/api/files` 浏览管理员可见的目录树。
- 服务端会拒绝以下操作，前端显示返回的错误信息：
  - 删除自己；
  - 删除、降级或禁用最后一个管理员；
  - 非法的用户名或 homeDir。

### 6.4 系统状态（ServerStatus.vue）

- 所有用户：端口、运行时长、局域网 IP，可一键复制 `sftp -P <port> <用户名>@<ip>`。
- 管理员额外可见：主机名、平台、内存、SFTP 连接数、存储根目录。
- 管理员可通过目录浏览器修改存储根目录（`PUT /api/settings`）。服务端会拒绝磁盘根、系统目录，以及与程序数据目录互相包含的路径。

### 6.5 快速连接（QuickConnect.vue，管理员）

- 每个局域网地址生成访问二维码，可复制访问 URL。
- 在线 SFTP 连接列表，可踢出（`DELETE /api/connections/:connId`）。
- 在线 Web 会话列表，按会话 ID 踢出（`DELETE /api/connections/web/:sessionKey`），被踢出的 Token 立即失效。
- 列表定时自动刷新。

## 7. 状态管理

### 7.1 Auth Store（`stores/auth.js`）

```javascript
{
  token: string | null,
  user: { username, role, permissions, homeDir, createdAt, enabled } | null,
  // computed
  isLoggedIn, isAdmin, canRead, canWrite, canDelete
}
// actions: setAuth(token, user), logout()
```

### 7.2 Files Store（`stores/files.js`）

```javascript
{
  currentPath: string,     // 当前虚拟路径，如 '/docs/images'
  files: FileItem[],       // { name, isDirectory, size, mtime }
  loading: boolean,
  breadcrumbs: string[]    // ['/', 'docs', 'images']
}
// actions: loadDir(path), navigateTo(index)
```

## 8. API 封装

- `baseURL` 为 `/api`。开发时由 Vite 代理到 `http://localhost:3000`，生产时与服务端同源。
- 默认请求超时 30 秒；上传和下载设置 `timeout: 0`，不限时。
- URL 中的用户名、会话 ID 等参数都经过 `encodeURIComponent` 编码。
- 完整接口说明见 [api.md](api.md)。

## 9. 开发与构建

```bash
cd client
npm install
npm run dev        # Vite 开发服务器 :8080，/api 代理到 :3000
npm run build      # 输出到 client/dist，由服务端托管
```

`vite.config.js`：

```javascript
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 8080,
    host: '0.0.0.0',   // 局域网可访问
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } }
  }
})
```

> 开发模式下经过代理转发的请求，在服务端看来都来自本机，因此局域网设备通过 `:8080` 也能调用初始化接口。仅在可信网络中使用开发模式，或在开发前先完成初始化。

## 10. 安全注意事项（前端）

- **不要引入外部脚本或 CDN 资源**。服务端的 CSP 为 `script-src 'self'`、`connect-src 'self'`，外部资源会被浏览器拦截。
- **v-html 必须经过 DOMPurify 净化**。
- **Token 保存在 localStorage 中**，一旦发生 XSS 就能被直接读取。因此上面两条防线（不引入外部资源、净化 v-html）必须保持。
- **新增接口调用时，路径类参数一律放在 query 或 body 中**，路由参数要用 `encodeURIComponent` 编码。
