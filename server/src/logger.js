const winston = require('winston');
const path = require('path');

const logsDir = process.env.LOGS_DIR || path.join(__dirname, '..', 'logs');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logsDir, 'server.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    })
  ]
});

module.exports = logger;
