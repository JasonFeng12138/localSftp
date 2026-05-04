# macOS App 打包指南

将 Local SFTP 打包为 macOS `.app` + `.dmg` 安装包。

## 前置条件

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 9 | 随 Node.js 附带 |
| Xcode Command Line Tools | 最新 | `xcode-select --install` |

## 一键构建

```bash
# 在项目根目录执行
bash scripts/build-mac.sh
```

脚本会自动完成：
1. 安装根目录依赖（含 Electron）
2. 构建 Vue 前端
3. 自动生成 `icon.icns`（如果 `build/icon.png` 存在）
4. 使用 electron-builder 打包

输出文件在 `dist-electron/` 目录：

| 文件 | 说明 |
|------|------|
| `Local SFTP-x.x.x-arm64.dmg` | Apple Silicon（M 系列）安装包 |
| `Local SFTP-x.x.x-universal.dmg` | Intel + Apple Silicon 通用包 |

## 分架构构建

```bash
# 仅 Apple Silicon（M1/M2/M3），速度更快
bash scripts/build-mac.sh --arm64

# 仅 Intel
bash scripts/build-mac.sh --x64
```

## 自定义图标

将 **1024×1024** PNG 图片放到 `build/icon.png`，构建脚本自动将其转换为 `icon.icns`。

## 网络问题（中国大陆）

如果构建过程中下载 Electron 缓慢，可在项目根目录手动创建 `.npmrc` 文件并配置淘宝镜像：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```

也可直接通过环境变量临时指定：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" bash scripts/build-mac.sh
```

## 安装方式

1. 双击 `.dmg` 文件
2. 将 `Local SFTP.app` 拖入 `/Applications`
3. 首次打开时会弹出**防火墙授权**提示 → 必须点**允许**，局域网其他设备才能访问

## App 数据目录

App 运行时的数据存储在：

```
~/Library/Application Support/local-sftp/
├── sftp-root/        # 上传文件存储目录（可在 App 内修改）
├── data/
│   ├── users.json    # 用户数据库
│   └── settings.json # 自定义配置（如修改过存储路径）
├── host-keys/        # SFTP RSA 主机密钥
└── logs/             # 运行日志
```

在 Finder 中快速打开：**前往** → **前往文件夹** → 粘贴路径：
```
~/Library/Application Support/local-sftp/sftp-root
```

## 重新打包（修改代码后）

```bash
# 快速重打包（跳过 npm install，仅构建前端 + 打包）
cd client && npm run build && cd ..
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npx electron-builder --mac --arm64
```

Electron 二进制会缓存在本地，第二次打包通常只需 1 分钟内完成。
