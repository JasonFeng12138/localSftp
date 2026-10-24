# 安全设计与部署指南

本文说明 Local SFTP 的威胁模型、各项防护机制、部署加固清单和已知限制。接口细节见 [api.md](api.md)，实现细节见 [server-design.md](server-design.md)。

## 1. 威胁模型

本工具运行在局域网中。服务端默认监听 `0.0.0.0`，因此**同一网络内的任何设备都可以访问 Web 端口和 SFTP 端口**。设计时考虑的攻击者包括：

| 攻击者 | 能力 | 需要防住的事情 |
|--------|------|----------------|
| 局域网内的匿名设备 | 能访问端口，但没有账号 | 抢先完成初始化、伪造 Token、暴力破解口令、获取主机信息 |
| 普通用户 | 持有合法账号 | 越出 homeDir、越权调用管理员接口、提权、让服务崩溃 |
| 有写权限的用户 | 能上传任意文件 | 用恶意文件（XSS）攻击管理员、借符号链接逃出存储目录 |
| 恶意网页 | 用户浏览器打开了第三方网站 | 跨域调用本服务的接口、把本服务页面嵌入 iframe |

以下情况**不在防护范围内**：
- 能登录服务端主机的人，包括本机的其他操作系统用户
- 嗅探局域网流量的人。Web 使用明文 HTTP，见第 5 节
- 管理员本身

## 2. 防护机制

### 2.1 认证与会话

| 机制 | 说明 |
|------|------|
| 密码存储 | bcrypt 哈希（cost 10），密码长度 6–128 |
| JWT 密钥 | 不再提供写死的默认值。`JWT_SECRET` 必须 ≥ 32 字符且不是已知示例值，否则会被忽略，改为自动生成随机密钥保存到 `data/jwt-secret` |
| Token 内容 | 只包含 `sub`（用户名）、`sid`（会话 ID）、`tv`（tokenVersion），不含权限 |
| 实时鉴权 | 每次请求都从用户库读取角色、权限和 homeDir，因此降权、修改 homeDir 立即生效 |
| Token 吊销 | 改密或禁用会使 `tokenVersion` 加 1，该用户所有 Token 失效。退出登录、管理员踢出会话时按 `sid` 吊销单个 Token |
| 算法固定 | 校验 Token 时只接受 HS256 |
| 登录限流 | Web 与 SFTP 共用：同一「IP + 用户名」15 分钟内失败 5 次即锁定，同一 IP 失败 30 次即锁定 |
| 防用户名枚举 | 用户不存在时同样执行一次 bcrypt 比较，使响应时间一致；登录失败统一返回 `Invalid credentials` |
| 初始管理员 | 未设置 `ADMIN_PASSWORD` 时随机生成密码，只打印到控制台，不写入日志 |

### 2.2 授权

- 权限模型分为 `read`、`write`、`delete`、`admin` 四项，Web 与 SFTP 使用同一套检查。
- 服务端会规范化角色与权限：
  - 普通用户不能拥有 `admin` 权限；
  - 没有 `read` 时，`write` 和 `delete` 一并去掉。
- 用户接口只接受白名单字段，防止通过批量赋值直接写入 `passwordHash`、`enabled` 等字段。
- 不能删除自己；至少要保留一个启用状态的管理员。
- 只有 `write` 权限时**不能借重命名覆盖已有文件**，因为覆盖等同于删除，需要 `delete` 权限。
- 用户被修改或删除后，服务端会断开其现有的 SFTP 连接。
- `/api/status` 对普通用户隐藏主机名、存储绝对路径、内存和平台信息。

### 2.3 路径隔离（chroot）

- 所有路径都通过 `FileService.resolvePath` 解析：
  - 用 `path.relative` 判断是否越出 homeDir；
  - 拒绝 NUL 字符，Windows 下拒绝 `:`（盘符和 NTFS 备用数据流）。
- **符号链接与目录联接**：对路径最近的已存在祖先目录执行 `realpath`，确认它仍在真实的 homeDir 内。这样即使有人在存储目录中放置了指向外部的链接，也无法借此访问外部文件。
- homeDir 写入用户库前会被规范化，并拒绝 `..`。
- 上传时只取文件名的 basename，`../../evil` 会被剥离成 `evil`。
- 不能删除或重命名 homeDir 本身（`/`）。
- **存储根目录的限制**：
  - 必须是绝对路径；
  - 不能是磁盘根目录或系统目录；
  - **不能与 `data/`、`host-keys/`、`logs/` 互相包含**。否则 homeDir 为 `/` 的用户就能读到密码哈希、主机私钥和 JWT 密钥，甚至改写 `users.json` 给自己提权。

### 2.4 初始化接口

- 只在系统中没有任何用户时开放，初始化完成后永久返回 403。
- 只接受**本机**请求：Host 必须是 `localhost`、`127.0.0.1` 或 `[::1]`，且来源 IP 必须是回环地址。校验 Host 可以防御 DNS 重绑定攻击。
- 加锁防止并发请求同时创建多个管理员。
- 目录浏览接口只能浏览当前操作系统用户的家目录。

### 2.5 Web 层

| 项 | 配置 |
|----|------|
| CORS | 不启用。之前的 `origin: true` 允许任意网站跨域调用接口，已移除 |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| 其他响应头 | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`；API 响应附加 `Cache-Control: no-store`；不返回 `X-Powered-By` |
| XSS | Markdown 预览经 DOMPurify 净化 |
| 请求限制 | JSON 请求体上限 100KB；每次上传只能有 1 个文件、最多 5 个字段，可通过 `MAX_UPLOAD_MB` 限制文件大小；query 只做扁平解析 |
| 错误脱敏 | 只返回业务错误，或由 fs 错误码映射成的固定提示；堆栈和绝对路径只写入日志；未知的 API 路由返回 404 |
| 审计日志 | 记录登录失败、上传、删除、重命名、用户变更、踢出连接；路径经 JSON 转义，防止伪造日志行 |

### 2.6 SFTP 层

- 所有请求处理函数都会捕获异常并返回 SFTP 状态码，**畸形请求无法让进程崩溃**。例如对目录句柄执行 READ、使用无效句柄。
- OPEN 会分别检查读权限和写权限，只有写权限的用户无法读取文件。
- 单次 READ 上限 256KB，防止客户端请求超大长度耗尽内存；READDIR 分批返回。
- 不支持 SYMLINK，因此用户无法通过 SFTP 自己创建链接。SETSTAT 不执行 chmod 或 chown。
- 主机密钥为 RSA 3072，文件权限 0600。

### 2.7 Electron

- 窗口设置 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- 窗口只能停留在 `http://localhost:<port>`。新窗口请求和跳转到其他来源时一律拦截，http(s) 链接改由系统浏览器打开。
- 打包时不包含 `server/data/`、`server/.env`、主机密钥、日志和存储目录。运行时数据写入 `userData` 目录。
- 不预置任何用户。首次运行时由用户在本机通过初始化向导创建管理员。

## 3. 部署加固清单

- [ ] **检查 `server/.env`**：
  - 删除 `ADMIN_PASSWORD=admin123` 这类示例值，或改为强密码；
  - `JWT_SECRET` 留空（自动生成）或填入 `openssl rand -hex 32` 生成的值。
- [ ] 首次登录后**立即修改初始管理员密码**。
- [ ] 存储目录使用专门的文件夹，不要放在含有其他敏感数据的目录下。
- [ ] 为普通用户分配独立的 homeDir，并按最小权限授予 `read` / `write` / `delete`。
- [ ] 只在可信的局域网中运行，不要把 2222 和 3000 端口暴露到公网。如需远程访问，请通过 VPN。
- [ ] 如只需本机访问，把 `WEB_HOST` / `SFTP_HOST` 设为 `127.0.0.1`。
- [ ] 按需设置 `MAX_UPLOAD_MB`，防止磁盘被占满。
- [ ] 保护好 `data/`、`host-keys/` 目录的文件系统权限。备份时注意其中包含密码哈希和私钥。
- [ ] 定期查看 `logs/server.log` 中的登录失败和审计记录。
- [ ] 升级依赖后在 `server/` 下运行 `npm test`，并分别在 `server/`、`client/` 和项目根目录运行 `npm audit`。

## 4. 已知限制

| 限制 | 影响 | 缓解措施或建议 |
|------|------|----------------|
| Web 使用明文 HTTP | 局域网中的流量嗅探者可以截获密码和 Token | 在可信网络中使用，或在前面加一层 HTTPS 反向代理（如 Caddy、nginx）。SFTP 本身是加密的 |
| Token 存储在 localStorage 中 | 一旦发生 XSS，Token 可被读取 | 已通过 DOMPurify 和严格 CSP 降低风险；如需更高安全性，可改为 HttpOnly Cookie 加 CSRF 防护 |
| 上传同名文件会直接覆盖 | 只有 `write` 权限的用户可以覆盖已有文件，在线编辑的保存功能依赖此行为 | 如需严格区分，可增加 `overwrite` 参数，并要求覆盖时具备 `delete` 权限 |
| SFTP 的 STAT/LSTAT 不检查 `read` 权限 | 没有 read 权限的用户可以探测 homeDir 内的文件是否存在及其大小 | 影响仅限其自身的 homeDir |
| 吊销列表与限流计数保存在内存中 | 重启后已吊销的单个会话会恢复有效（直到过期），限流计数也会清零 | 改密和禁用依赖持久化的 `tokenVersion`，不受重启影响 |
| 开发模式下的 Vite 代理 | 经代理的请求在服务端看来都来自本机，局域网设备可以访问初始化接口 | 只在开发时出现。先完成初始化，或把 Vite 改为只监听 localhost |
| Express 4 依赖的 `qs` 有中危漏洞通告 | 无法单独升级 | 已切换到 `simple` query 解析，不再调用 `qs` 的解析逻辑 |

## 5. 漏洞报告

如发现安全问题，请不要公开提交 issue，可以直接联系维护者。报告时请附上复现步骤和影响范围。
