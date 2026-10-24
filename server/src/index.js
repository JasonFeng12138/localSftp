require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const logger = require('./logger');
const { loadSettings, validateSftpRoot, getJwtSecret } = require('./config');
const UserManager = require('./user-manager');
const FileService = require('./file-service');
const SftpServer = require('./sftp-server');
const createWebServer = require('./web-server');

async function main() {
  logger.info('=== Local SFTP Tool Starting ===');

  // 1. Initialize file service（持久化设置优先于环境变量；启动时同样做安全校验）
  const settings = loadSettings();
  const sftpRoot = validateSftpRoot(path.resolve(settings.sftpRoot || process.env.SFTP_ROOT || './sftp-root'));
  const fileService = new FileService(sftpRoot);
  logger.info(`SFTP root: ${sftpRoot}`);

  // 2. Initialize user manager & default admin
  const userManager = new UserManager();
  if (!process.env.SKIP_DEFAULT_ADMIN && userManager.isEmpty) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      // 不再使用写死的默认密码，未配置时随机生成；只打印到控制台，不写入日志文件
      password = crypto.randomBytes(12).toString('base64url');
      logger.warn(`未设置 ADMIN_PASSWORD，已为管理员 "${username}" 生成随机初始密码（见控制台输出），请登录后立即修改`);
      console.log(`\n  初始管理员: ${username}\n  初始密码:   ${password}\n`);
    } else if (password === 'admin123') {
      logger.warn('ADMIN_PASSWORD 仍为示例值 admin123，请尽快修改');
    }
    await userManager.initDefaultAdmin(username, password);
  }

  // 3. Start SFTP server
  const sftpPort = parseInt(process.env.SFTP_PORT, 10) || 2222;
  const sftpHost = process.env.SFTP_HOST || '0.0.0.0';
  const sftpServer = new SftpServer(userManager, fileService, { port: sftpPort, host: sftpHost });
  sftpServer.start();

  // 4. Start Web API server
  const webPort = parseInt(process.env.WEB_PORT, 10) || 3000;
  const webHost = process.env.WEB_HOST || '0.0.0.0';
  const app = createWebServer({ userManager, fileService, sftpServer, jwtSecret: getJwtSecret() });
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
