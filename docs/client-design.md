# SFTP 工具 — 客户端设计文档

## 1. 项目概述

基于 Vue 3 的 Web 文件管理客户端，通过 REST API 连接服务端，提供可视化的文件浏览、上传、下载、在线预览/编辑、用户管理等功能。

## 2. 技术选型

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端框架 | Vue 3 | ^3.5.0 | Composition API + `<script setup>` |
| 构建工具 | Vite | ^6.0.0 | 极速开发体验 |
| UI 组件库 | Element Plus | ^2.9.0 | 成熟的 Vue 3 组件库 |
| HTTP 请求 | Axios | ^1.7.0 | Promise 化 HTTP 客户端 |
| 路由 | Vue Router | ^4.5.0 | SPA 路由管理 |
| 状态管理 | Pinia | ^2.3.0 | Vue 3 官方状态管理 |
| 图标 | @element-plus/icons-vue | ^2.3.0 | Element Plus 图标库 |
| Markdown 渲染 | marked | ^12.0.0 | 在线预览 Markdown |

## 3. 页面结构

```
┌─────────────────────────────────────────────────────┐
│  顶部导航栏 (Layout.vue)                              │
│  [Logo/标题]          [文件管理] [用户管理] [系统状态] [退出] │
├─────────────────────────────────────────────────────┤
│  主内容区                                            │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │ 面包屑: / > docs > images     [过滤] [上传] [新建] [刷新] │
│  ├───────────────────────────────────────────────┤  │
│  │ 文件列表（表格）                               │  │
│  │ 名称       | 大小  | 修改时间  | 操作          │  │
│  │ 📁 docs     —      2026-04-01  ...            │  │
│  │ 📄 readme.md 2KB   2026-04-02  [可编辑] ...   │  │
│  │ 🖼 photo.png 500KB 2026-04-03  [图片]   ...   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 4. 目录结构

```
client/
├── src/
│   ├── main.js                 # 入口
│   ├── App.vue                 # 根组件（路由出口）
│   ├── router/
│   │   └── index.js            # 路由配置（含导航守卫）
│   ├── stores/
│   │   ├── auth.js             # 认证状态
│   │   └── files.js            # 文件列表状态
│   ├── api/
│   │   ├── index.js            # Axios 实例 + 拦截器
│   │   ├── auth.js             # 认证 API
│   │   ├── files.js            # 文件操作 API
│   │   ├── users.js            # 用户管理 API
│   │   └── status.js           # 系统状态 API
│   ├── views/
│   │   ├── Login.vue           # 登录页
│   │   ├── Layout.vue          # 主布局（侧边导航 + 路由容器）
│   │   ├── FileManager.vue     # 文件管理页（核心）
│   │   ├── UserManager.vue     # 用户管理页（管理员）
│   │   └── ServerStatus.vue    # 系统状态页
│   └── utils/
│       └── format.js           # 文件大小/日期/运行时长格式化
├── index.html
├── vite.config.js
└── package.json
```

## 5. 核心功能

### 5.1 登录

- 用户名 + 密码表单
- 登录成功后存储 JWT Token 到 localStorage，同时保存 user 信息（username、role、permissions、homeDir）
- Axios 请求拦截器自动携带 `Authorization: Bearer <token>` 头
- 响应拦截器：401 → 清除 token 并跳转登录页

### 5.2 文件管理（核心页面）

| 功能 | 说明 |
|------|------|
| 目录浏览 | 双击文件夹进入，面包屑导航点击回退到任意层级 |
| 文件名过滤 | 工具栏搜索框，实时过滤当前目录的文件名 |
| 文件上传 | 工具栏按钮（多文件选择）+ 区域拖拽，两种方式均支持 |
| 文件下载 | 通过操作菜单或预览弹窗下载 |
| 新建文件夹 | 弹窗输入名称 |
| 重命名 | 操作菜单 → 重命名弹窗 |
| 删除 | 操作菜单 → 확认弹窗后删除（支持递归删除目录） |
| 拖拽移动 | 将行拖入另一个文件夹实现移动；有写权限时可用 |
| 移动到上级 | 操作菜单快捷项，将文件/目录移动到父目录 |
| 在线预览 | 文本（高亮/plain）、Markdown 渲染、图片（jpg/png/gif/webp/svg/bmp）|
| 在线编辑 | txt/md/json/js/ts/css/html/xml/yaml/yml/sh/env/ini/conf，支持保存覆盖 |
| 操作菜单 | 每行右侧 `...` 下拉菜单，根据权限和文件类型动态显示项目 |
| 文件类型徽标 | 名称列右侧 tag 标注「可编辑」「图片」「可预览」，hover 显示支持格式 |

### 5.3 用户管理（管理员）

| 功能 | 说明 |
|------|------|
| 用户列表 | 表格展示用户名、角色、权限、主目录、状态 |
| 新增用户 | 弹窗输入用户名、密码、角色、权限、homeDir |
| 编辑用户 | 修改密码（可选）、权限、homeDir、启用/禁用 |
| 删除用户 | 确认后删除（保护当前登录用户不被删除） |
| 权限联动 | 取消 read 自动去掉 write/delete；选择 admin 角色自动全选权限 |
| homeDir 选择器 | 内置目录浏览弹窗，可视化选择 homeDir，无需手动输入路径 |

### 5.4 系统状态

- 主机名、平台、SFTP/Web 端口
- 当前 SFTP 连接数、运行时长、内存占用
- 网络接口 IP 列表，每行有「复制 SFTP 命令」按钮（自动填入当前登录用户名）

## 6. 路由设计

| 路径 | 组件 | 权限 | 说明 |
|------|------|------|------|
| /login | Login.vue | 公开 | 登录页 |
| / | FileManager.vue | 需认证 | 文件管理（默认页） |
| /users | UserManager.vue | admin | 用户管理 |
| /status | ServerStatus.vue | 需认证 | 系统状态 |

路由守卫：未登录访问受保护路由 → 跳转 `/login`；已登录访问 `/login` → 跳转 `/`；非 admin 访问 `/users` → 跳转 `/`。

## 7. API 交互

### 7.1 Axios 实例配置

- `baseURL`: 开发环境 Vite proxy `/api` → `http://localhost:3000`；生产同源 `/api`
- 请求拦截器: 自动附加 `Authorization: Bearer <token>`
- 响应拦截器: 401 → `auth.logout()` + router.push('/login')

### 7.2 主要 API

```
GET    /api/files?path=/               目录列表
GET    /api/files/download?path=/a.txt 下载（Blob）
POST   /api/files/upload               上传（FormData: file + path）
POST   /api/files/mkdir                创建目录
DELETE /api/files?path=/a.txt          删除
PUT    /api/files/rename               重命名/移动 { oldPath, newPath }
GET    /api/files/stat?path=/a.txt     文件元信息
GET    /api/users                      用户列表（admin）
POST   /api/users                      创建用户
PUT    /api/users/:username            修改用户
DELETE /api/users/:username            删除用户
GET    /api/status                     服务器状态
POST   /api/auth/login                 登录 → { token, user }
```

## 8. 状态管理

### 8.1 Auth Store (`stores/auth.js`)

```javascript
{
  token: string | null,
  user: { username, role, permissions, homeDir } | null,
  // computed
  isLoggedIn: boolean,
  isAdmin: boolean,
  canRead: boolean,        // permissions.includes('read')
  canWrite: boolean,       // permissions.includes('write')
  canDelete: boolean,      // permissions.includes('delete')
}
// actions: setAuth(token, user), logout()
```

### 8.2 Files Store (`stores/files.js`)

```javascript
{
  currentPath: string,       // 当前目录虚拟路径，如 '/docs/images'
  files: FileItem[],         // 当前目录完整列表（过滤在组件层 computed 完成）
  loading: boolean,
  breadcrumbs: string[],     // 路径段数组，如 ['~', 'docs', 'images']
}
// actions: loadDir(path), navigateTo(segIndex)
```

## 9. UI/UX 设计

1. **权限驱动 UI** — 上传/新建/重命名/移动/删除按钮会根据 canWrite/canDelete 动态隐藏
2. **拖拽限制** — 无写权限时 draggable=false，行样式 cursor:default
3. **面包屑** — 点击任意段快速跳转，始终从虚拟根 `/` 开始
4. **在线编辑脏检查** — 有未保存内容时关闭弹窗会触发二次确认
5. **图片预览** — Object URL 形式加载，弹窗关闭时自动 revoke 释放内存
6. **过滤搜索** — 切换目录后过滤框内容不自动清空，方便跨目录比对
7. **操作菜单** — `...` 下拉，按文件类型和权限动态显示：预览 / 编辑 / 下载 / 重命名 / 移动到上级 / 删除

## 10. 开发与构建

```bash
# 开发（局域网可访问）
cd client
npm install
npm run dev        # Vite dev server on :8080, proxy /api → :3000

# 构建
npm run build      # 输出到 dist/

# 生产部署
# dist/ 静态文件由 Express 服务端托管，访问 http://<server-ip>:3000
```

## 11. Vite 配置

```javascript
// vite.config.js
export default {
  server: {
    port: 8080,
    host: '0.0.0.0',     // 局域网可访问
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
}
```


## 3. 页面结构

```
┌─────────────────────────────────────────────────────┐
│  顶部导航栏                                          │
│  [Logo/标题]          [服务状态]  [用户名]  [退出]     │
├────────────┬────────────────────────────────────────┤
│  侧边栏     │  主内容区                               │
│             │                                        │
│  ● 文件管理  │  ┌─────────────────────────────────┐  │
│  ● 用户管理  │  │ 路径导航: / > docs > images      │  │
│  ● 系统状态  │  │ [上传] [新建文件夹] [刷新]        │  │
│             │  ├─────────────────────────────────┤  │
│             │  │ 文件列表 (表格)                   │  │
│             │  │ 名称 | 大小 | 修改时间 | 操作     │  │
│             │  │ 📁 docs      —    2026-04-01  ...│  │
│             │  │ 📄 readme.md 2KB  2026-04-02  ...│  │
│             │  │ 📄 app.zip  50MB  2026-04-03  ...│  │
│             │  └─────────────────────────────────┘  │
│             │                                        │
├────────────┴────────────────────────────────────────┤
│  底部状态栏: SFTP 端口 2222 | API 端口 3000 | 连接正常 │
└─────────────────────────────────────────────────────┘
```

## 4. 目录结构

```
client/
├── public/
│   └── favicon.ico
├── src/
│   ├── main.js                 # 入口
│   ├── App.vue                 # 根组件
│   ├── router/
│   │   └── index.js            # 路由配置
│   ├── stores/
│   │   ├── auth.js             # 认证状态
│   │   └── files.js            # 文件列表状态
│   ├── api/
│   │   ├── index.js            # Axios 实例 + 拦截器
│   │   ├── auth.js             # 认证 API
│   │   ├── files.js            # 文件操作 API
│   │   ├── users.js            # 用户管理 API
│   │   └── status.js           # 系统状态 API
│   ├── views/
│   │   ├── Login.vue           # 登录页
│   │   ├── FileManager.vue     # 文件管理页 (核心)
│   │   ├── UserManager.vue     # 用户管理页
│   │   └── ServerStatus.vue    # 系统状态页
│   ├── components/
│   │   ├── AppHeader.vue       # 顶部导航
│   │   ├── AppSidebar.vue      # 侧边栏
│   │   ├── BreadcrumbNav.vue   # 路径面包屑导航
│   │   ├── FileTable.vue       # 文件列表表格
│   │   ├── UploadDialog.vue    # 上传对话框
│   │   └── RenameDialog.vue    # 重命名对话框
│   └── utils/
│       ├── format.js           # 文件大小/日期格式化
│       └── path.js             # 路径工具函数
├── index.html
├── vite.config.js
└── package.json
```

## 5. 核心功能

### 5.1 登录

- 用户名 + 密码表单
- 登录成功后存储 JWT Token 到 localStorage
- Axios 请求拦截器自动携带 Authorization 头
- Token 过期后自动跳转登录页

### 5.2 文件管理 (核心页面)

| 功能 | 说明 |
|------|------|
| 目录浏览 | 点击文件夹进入，面包屑导航回退 |
| 文件上传 | 按钮上传 + 拖拽上传，支持多文件，显示进度条 |
| 文件下载 | 点击下载按钮，浏览器直接下载 |
| 新建文件夹 | 弹窗输入名称，创建子目录 |
| 重命名 | 弹窗修改文件/目录名称 |
| 删除 | 确认弹窗后删除，支持递归删除目录 |
| 文件信息 | 显示名称、大小、修改时间、类型 |

### 5.3 用户管理 (管理员)

- 用户列表 (表格)
- 新增用户
- 修改用户 (密码、权限、启用/禁用)
- 删除用户

### 5.4 系统状态

- 服务器 IP 与端口
- 当前 SFTP 连接数
- 磁盘使用情况
- 在线时长

## 6. 路由设计

| 路径 | 组件 | 权限 | 说明 |
|------|------|------|------|
| /login | Login.vue | 公开 | 登录页 |
| / | FileManager.vue | 需认证 | 文件管理 (默认页) |
| /users | UserManager.vue | admin | 用户管理 |
| /status | ServerStatus.vue | 需认证 | 系统状态 |

## 7. API 交互

### 7.1 Axios 实例配置

```javascript
// baseURL 根据当前环境自动配置
// 开发环境: http://localhost:3000/api
// 生产环境: /api (同源部署)

// 请求拦截器: 自动附加 JWT Token
// 响应拦截器: 401 → 跳转登录页，统一错误提示
```

### 7.2 API 调用映示例

```javascript
// 列出目录
GET /api/files?path=/docs → [{ name, size, mtime, isDirectory }]

// 上传文件
POST /api/files/upload (FormData: file + path) → { success }

// 下载文件
GET /api/files/download?path=/docs/a.txt → Blob

// 创建目录
POST /api/files/mkdir { path: '/docs/new-folder' } → { success }

// 删除
DELETE /api/files?path=/docs/a.txt → { success }

// 重命名
PUT /api/files/rename { oldPath, newPath } → { success }
```

## 8. 状态管理

### 8.1 Auth Store

```javascript
{
  token: string | null,
  user: { username, role, permissions } | null,
  isLoggedIn: boolean (computed)
}
```

### 8.2 Files Store

```javascript
{
  currentPath: string,       // 当前目录路径
  files: FileItem[],         // 当前目录的文件列表
  loading: boolean,          // 加载状态
  breadcrumbs: string[]      // 面包屑路径段
}
```

## 9. UI/UX 设计要点

1. **响应式布局** — 侧边栏可折叠，适应不同屏幕
2. **拖拽上传** — 文件拖拽到内容区即可上传
3. **进度显示** — 上传/下载显示进度条和百分比
4. **面包屑导航** — 快速跳转任意父级目录
5. **文件图标** — 根据扩展名显示不同图标
6. **操作确认** — 删除等危险操作需二次确认
7. **错误提示** — 统一的 ElMessage 错误/成功提示
8. **暗色主题** — 基于 Element Plus 主题切换 (可选)

## 10. 开发与构建

```bash
# 开发
cd client
npm install
npm run dev        # Vite dev server on :5173, proxy /api → :3000

# 构建
npm run build      # 输出到 dist/

# 生产部署
# 将 dist/ 静态文件由 Express 服务端托管
```

## 11. Vite 代理配置

```javascript
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
}
```
