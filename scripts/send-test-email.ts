// Manual smoke test — run once real Gmail App Password credentials are in .env.
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createTransport, sendEmail } from '../src/email/sender.js';
import { createLogger } from '../src/logger.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logDir, config.logLevel);
  const transport = createTransport(config);

  await sendEmail(
    transport,
    config,
    {
      subject: '[PNCP] Test email',
      text: 'This is a test email from the PNCP audiovisual tender monitor.',
      html: '<p>This is a test email from the PNCP audiovisual tender monitor.</p>',
    },
    logger,
    { cycleId: 'manual-test' },
  );

  console.log('Test email sent successfully.');
}

main().catch((error) => {
  console.error('Failed to send test email:', error);
  process.exit(1);
});
