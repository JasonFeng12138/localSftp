'use strict';

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');

// ── 获取局域网 IPv4 地址列表 ─────────────────────────────────────────────────
function getLanIPs() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// ── 1. 设置可写目录（打包后 asar 只读，数据必须写到 userData）──────────────
const userDataPath = app.getPath('userData');
const sftpRoot    = path.join(userDataPath, 'sftp-root');
const hostKeysDir = path.join(userDataPath, 'host-keys');
const dataDir     = path.join(userDataPath, 'data');
const logsDir     = path.join(userDataPath, 'logs');

[sftpRoot, hostKeysDir, dataDir, logsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 不预置 users.json，首次启动时 UserManager 会发现无用户，
// 前端路由守卫检测到后跳转到 /setup 完成初始化

// dotenv 默认不会覆盖已存在的环境变量，所以先设置再 require 服务端代码
process.env.SFTP_ROOT          = sftpRoot;
process.env.HOST_KEYS_DIR      = hostKeysDir;
process.env.DATA_DIR           = dataDir;
process.env.LOGS_DIR           = logsDir;
process.env.SFTP_PORT          = process.env.SFTP_PORT || '2222';
process.env.WEB_PORT           = process.env.WEB_PORT  || '3000';
process.env.SKIP_DEFAULT_ADMIN = 'true'; // 由前端 setup 向导创建管理员

// ── 2. 启动内嵌服务端 ────────────────────────────────────────────────────────
const startServer = require('../server/src/index.js');
startServer().catch(err => {
  console.error('[Electron] Server failed to start:', err);
});

// ── 3. 等待 Web 端口就绪 ─────────────────────────────────────────────────────
function waitForPort(port, maxWaitMs = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const tryConnect = () => {
      if (Date.now() - startTime > maxWaitMs) {
        reject(new Error(`端口 ${port} 在 ${maxWaitMs / 1000} 秒内未就绪，服务可能启动失败`));
        return;
      }
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket
        .on('connect', () => { socket.destroy(); resolve(); })
        .on('error',   () => setTimeout(tryConnect, 300))
        .on('timeout', () => { socket.destroy(); setTimeout(tryConnect, 300); })
        .connect(port, '127.0.0.1');
    };
    tryConnect();
  });
}

// ── 4. 创建主窗口 ────────────────────────────────────────────────────────────
let mainWindow = null;
let tray       = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    title:  'Local SFTP',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const port = parseInt(process.env.WEB_PORT, 10) || 3000;
  waitForPort(port).then(() => {
    mainWindow.loadURL(`http://localhost:${port}`);
  });

  // 关闭窗口时隐藏（保持后台服务运行），点 Dock 图标可重新打开
  mainWindow.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── 5. 系统托盘 ──────────────────────────────────────────────────────────────
function createTray() {
  // 尝试加载图标；打包后从 resources，开发时从 build 目录
  const iconPaths = [
    path.join(__dirname, '..', 'build', 'tray-icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
  ];
  let icon = nativeImage.createEmpty();
  for (const p of iconPaths) {
    if (fs.existsSync(p)) {
      icon = nativeImage.createFromPath(p);
      break;
    }
  }
  // 若没有图标文件，使用 16×16 空图（托盘仍可用）
  if (icon.isEmpty()) {
    // 创建一个简单的 16x16 PNG 占位图
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAN0lEQVQ4jWNgGAWjAAT+//9vwIABGBkZGWBiJAMWBkYGBgZGBgYGJgYGBiYGBgYmBgYGJgYGBgDRZAIJz1SZGQAAAABJRU5ErkJggg=='
    );
  }

  tray = new Tray(icon);
  tray.setToolTip('Local SFTP');

  const webPort = process.env.WEB_PORT || 3000;
  const sftpPort = process.env.SFTP_PORT || 2222;
  const lanIPs = getLanIPs();

  // 构建 IP 菜单项：每个 IP 一条，点击复制访问地址
  const ipMenuItems = lanIPs.length > 0
    ? lanIPs.map(ip => ({
        label: `  http://${ip}:${webPort}  （点击复制）`,
        click: () => clipboard.writeText(`http://${ip}:${webPort}`),
      }))
    : [{ label: '  未检测到局域网 IP', enabled: false }];

  const menu = Menu.buildFromTemplate([
    {
      label: '打开管理界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '在浏览器中打开',
      click: () => shell.openExternal(`http://localhost:${webPort}`),
    },
    { type: 'separator' },
    { label: '── 局域网访问地址 ──', enabled: false },
    ...ipMenuItems,
    { type: 'separator' },
    { label: `SFTP 端口: ${sftpPort}`, enabled: false },
    { label: `Web  端口: ${webPort}`,  enabled: false },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── 6. App 生命周期 ──────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();

    // 服务就绪后发送系统通知，告知局域网访问地址
    const webPort = parseInt(process.env.WEB_PORT, 10) || 3000;
    waitForPort(webPort).then(() => {
      const lanIPs = getLanIPs();
      if (Notification.isSupported() && lanIPs.length > 0) {
        new Notification({
          title: 'Local SFTP 已启动',
          body: `局域网访问: http://${lanIPs[0]}:${webPort}`,
        }).show();
      }
    }).catch(err => {
      const { dialog } = require('electron');
      dialog.showErrorBox('Local SFTP 启动失败', err.message + '\n\n请检查端口是否被占用，或重启应用。');
      app.quit();
    });

    // macOS: 点击 Dock 图标重新显示窗口
    app.on('activate', () => {
      if (mainWindow) mainWindow.show();
    });
  });
}

// 所有窗口关闭时不退出（依赖托盘菜单退出）
app.on('window-all-closed', () => {
  // macOS 常规行为：不退出，由托盘控制
});

// Cmd+Q / Dock 退出 → 标记后正常退出
app.on('before-quit', () => {
  app.isQuitting = true;
});
