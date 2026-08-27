import nodemailer from 'nodemailer';
import type winston from 'winston';
import type { Config } from '../config.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function createTransport(config: Config) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpAppPassword,
    },
  });
}

export async function sendEmail(
  transport: ReturnType<typeof createTransport>,
  config: Config,
  content: EmailContent,
  logger: winston.Logger,
  logContext: Record<string, unknown>,
): Promise<void> {
  try {
    const info = await transport.sendMail({
      from: config.smtpUser,
      to: config.recipientEmails.join(','),
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    logger.info('email.sent', { ...logContext, messageId: info.messageId, accepted: info.accepted });
    if (info.rejected.length > 0) {
      logger.warn('email.partially_rejected', { ...logContext, rejected: info.rejected });
    }
  } catch (error) {
    logger.error('email.failed', { ...logContext, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
