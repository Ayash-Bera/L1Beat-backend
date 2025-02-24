const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Determine log directory based on environment
// Vercel has a read-only filesystem except for /tmp
const isVercel = process.env.VERCEL === '1';
const logDir = isVercel ? '/tmp/logs' : 'logs';

// Create log directory if it doesn't exist and we're in an environment where we can write
if (process.env.NODE_ENV === 'production') {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (error) {
    console.error(`Error creating log directory: ${error.message}`);
    // Continue without file logging if directory creation fails
  }
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    return JSON.stringify({
      level,
      timestamp,
      message,
      ...meta
    });
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'l1beat-backend' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 
            ? ` ${JSON.stringify(meta, null, 2)}` 
            : '';
          return `${timestamp} ${level}: ${message}${metaStr}`;
        })
      )
    })
  ]
});

// Add file transports in production only if we can write to the filesystem
if (process.env.NODE_ENV === 'production') {
  try {
    logger.add(new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }));
    
    logger.add(new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }));
    
    logger.info('File logging enabled');
  } catch (error) {
    logger.error(`Could not initialize file logging: ${error.message}`);
    logger.info('Continuing with console logging only');
  }
}

// Create a stream object for Morgan
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

module.exports = logger; 