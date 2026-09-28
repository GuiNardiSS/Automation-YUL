import nodemailer from 'nodemailer';
import type winston from 'winston';
import type { Config } from '../config.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

// Explicit, deliberately modest timeouts (nodemailer's own defaults run into
// multiple minutes) — this now runs inside a billed-by-the-minute GitHub
// Actions job, so a stalled SMTP handshake/send must fail fast rather than
// silently consuming the job's time budget, matching the same reasoning
// already applied to the Redis and PNCP connections.
const SMTP_CONNECTION_TIMEOUT_MS = 10000;
const SMTP_GREETING_TIMEOUT_MS = 10000;
const SMTP_SOCKET_TIMEOUT_MS = 20000;

export function createTransport(config: Config) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpAppPassword,
    },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });
}

export async function sendEmail(
  transport: ReturnType<typeof createTransport>,
  config: Config,
  content: EmailContent,
  logger: winston.Logger,
  logContext: Record<string, unknown>,
  recipients: string[] = config.recipientEmails,
): Promise<void> {
  try {
    const info = await transport.sendMail({
      from: config.smtpUser,
      to: recipients.join(','),
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
