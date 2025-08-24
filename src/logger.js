const winston = require('winston');

function createLogger(options = {}) {
  const { level = 'info', silent = false } = options;
  
  return winston.createLogger({
    level,
    silent,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level}]: ${message}`;
      })
    ),
    transports: [
      new winston.transports.Console()
    ]
  });
}

module.exports = { createLogger };