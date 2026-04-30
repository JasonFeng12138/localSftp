require('dotenv').config();

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const UserManager = require('./user-manager');
const FileService = require('./file-service');
const SftpServer = require('./sftp-server');
const createWebServer = require('./web-server');

// 读取持久化的用户自定义设置（存在 DATA_DIR/settings.json）
function loadSettings() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const settingsFile = path.join(dataDir, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch {}
  }
  return {};
}

async function main() {
  logger.info('=== Local SFTP Tool Starting ===');

  const settings = loadSettings();

  // 1. Initialize file service
  const sftpRoot = path.resolve(settings.sftpRoot || process.env.SFTP_ROOT || './sftp-root');
  const fileService = new FileService(sftpRoot);
  logger.info(`SFTP root: ${sftpRoot}`);

  // 2. Initialize user manager & default admin
  const userManager = new UserManager();
  if (!process.env.SKIP_DEFAULT_ADMIN) {
    await userManager.initDefaultAdmin(
      process.env.ADMIN_USERNAME || 'admin',
      process.env.ADMIN_PASSWORD || 'admin123'
    );
  }

  // 3. Start SFTP server
  const sftpPort = parseInt(process.env.SFTP_PORT, 10) || 2222;
  const sftpHost = process.env.SFTP_HOST || '0.0.0.0';
  const sftpServer = new SftpServer(userManager, fileService, { port: sftpPort, host: sftpHost });
  sftpServer.start();

  // 4. Start Web API server
  const webPort = parseInt(process.env.WEB_PORT, 10) || 3000;
  const webHost = process.env.WEB_HOST || '0.0.0.0';
  const app = createWebServer(userManager, fileService, sftpServer);
  app.listen(webPort, webHost, () => {
    logger.info(`Web API listening on ${webHost}:${webPort}`);
    logger.info('=== Server Ready ===');
    logger.info(`  SFTP:  sftp://localhost:${sftpPort}`);
    logger.info(`  Web:   http://localhost:${webPort}`);
  });
}

// 直接运行时自动启动；被 require 时导出 main 供 Electron 调用
if (require.main === module) {
  main().catch(err => {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = main;
