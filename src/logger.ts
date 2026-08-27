import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

export function createLogger(logDir: string, logLevel: string): winston.Logger {
  return winston.createLogger({
    level: logLevel,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
      new winston.transports.Console(),
      new DailyRotateFile({
        dirname: logDir,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
      }),
      new DailyRotateFile({
        dirname: logDir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
      }),
    ],
  });
}
