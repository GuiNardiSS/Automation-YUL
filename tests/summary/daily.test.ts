import RedisMock from 'ioredis-mock';
import winston from 'winston';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { finishRun } from '../../src/summary/daily.js';

// America/Sao_Paulo is fixed at UTC-3.
function saoPaulo(isoLocal: string): Date {
  return new Date(`${isoLocal}-03:00`);
}

const ALERT_A = { title: 'Produção audiovisual para evento', link: 'https://pncp.gov.br/app/editais/111/2026/1' };
const ALERT_B = { title: 'Serviços de filmagem institucional', link: 'https://pncp.gov.br/app/editais/222/2026/2' };

function okRun(alertsSent: Array<{ title: string; link: string }> = [], totalFetched = 2500, failedQueries = 0) {
  return { ok: true as const, result: { totalFetched, alertsSent, failedQueries } };
}

type Sent = { to: string; subject: string; text: string };

function makeHarness(extraEnv: Record<string, string> = {}, options: { failFirstSends?: number } = {}) {
  const config = loadConfig({
    SMTP_USER: 'alerts@example.com',
    SMTP_APP_PASSWORD: 'app-password',
    RECIPIENT_EMAILS: 'client@example.com',
    REDIS_URL: 'redis://unused',
    DAILY_SUMMARY_EMAIL: 'owner@example.com',
    ...extraEnv,
  });
  const sent: Sent[] = [];
  let failuresLeft = options.failFirstSends ?? 0;
  const emailTransport = {
    sendMail: async (message: Sent) => {
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error('SMTP temporarily unavailable');
      }
      sent.push(message);
      return { messageId: 'id', accepted: [message.to], rejected: [] };
    },
  };
  const redis = new RedisMock() as any;
  const finish = (now: Date, outcome: Parameters<typeof finishRun>[0]['outcome']) =>
    finishRun({
      config,
      logger: winston.createLogger({ silent: true }),
      redis,
      emailTransport: emailTransport as any,
      now,
      outcome,
    });
  return { sent, finish };
}

describe('finishRun daily summary', () => {
  beforeEach(async () => {
    // ioredis-mock instances share one in-memory store across the test file.
    await new RedisMock().flushall();
  });

  it('sends one summary with the day totals and alert links at the first run after the summary hour', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T08:17:00'), okRun());
    await finish(saoPaulo('2026-09-28T10:17:00'), okRun([ALERT_A, ALERT_B]));
    await finish(saoPaulo('2026-09-28T12:17:00'), okRun());
    expect(sent).toHaveLength(0);

    await finish(saoPaulo('2026-09-28T16:17:00'), okRun());

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/Resumo diário/);
    expect(sent[0].text).toMatch(/Execuções hoje:\s*4\b/);
    expect(sent[0].text).toContain(ALERT_A.link);
    expect(sent[0].text).toContain(ALERT_B.link);
  });

  it("reports the latest run's tender count, not a sum that would count the same tenders repeatedly", async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T14:17:00'), okRun([], 1111));
    await finish(saoPaulo('2026-09-28T16:17:00'), okRun([], 2345));

    expect(sent[0].text).toMatch(/2\.?345/);
    expect(sent[0].text).not.toMatch(/1\.?111/);
    expect(sent[0].text).not.toMatch(/3\.?456/);
  });

  it('does not send the summary again for a later run on the same day', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T16:17:00'), okRun());
    await finish(saoPaulo('2026-09-28T17:40:00'), okRun());

    expect(sent).toHaveLength(1);
  });

  it('treats the day by Sao Paulo time, so a late-evening run (already the next day in UTC) does not resend', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T16:17:00'), okRun());
    await finish(saoPaulo('2026-09-28T22:00:00'), okRun());

    expect(sent).toHaveLength(1);
  });

  it('reports a failed run in the summary, including why it failed', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T16:17:00'), {
      ok: false,
      error: 'PNCP appears to be down: 3 consecutive requests failed, aborting run',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('PNCP appears to be down');
  });

  it('includes a failure from an earlier run of the day in the evening summary', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T10:17:00'), { ok: false, error: 'WRONGPASS invalid username-password pair' });
    await finish(saoPaulo('2026-09-28T16:17:00'), okRun());

    expect(sent[0].text).toContain('WRONGPASS');
  });

  it('reports PNCP queries that failed in otherwise successful runs', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T10:17:00'), okRun([], 2500, 2));
    await finish(saoPaulo('2026-09-28T16:17:00'), okRun([], 2500, 1));

    expect(sent[0].text).toMatch(/Consultas ao PNCP com falha:\s*3\b/);
  });

  it('retries the summary on the next run when sending it fails, without failing the run itself', async () => {
    const { sent, finish } = makeHarness({}, { failFirstSends: 1 });

    await expect(finish(saoPaulo('2026-09-28T16:17:00'), okRun())).resolves.not.toThrow();
    expect(sent).toHaveLength(0);

    await finish(saoPaulo('2026-09-28T17:30:00'), okRun());
    expect(sent).toHaveLength(1);
  });

  it('sends the summary only to the summary address, not to the alert recipients', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-28T16:17:00'), okRun());

    expect(sent[0].to).toBe('owner@example.com');
  });

  it('does not include alerts sent on a previous day', async () => {
    const { sent, finish } = makeHarness();

    await finish(saoPaulo('2026-09-27T10:17:00'), okRun([ALERT_A]));
    await finish(saoPaulo('2026-09-28T16:17:00'), okRun([ALERT_B]));

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(ALERT_B.link);
    expect(sent[0].text).not.toContain(ALERT_A.link);
  });

  it('respects a configured summary hour', async () => {
    const { sent, finish } = makeHarness({ DAILY_SUMMARY_HOUR: '14' });

    await finish(saoPaulo('2026-09-28T12:17:00'), okRun());
    expect(sent).toHaveLength(0);

    await finish(saoPaulo('2026-09-28T14:17:00'), okRun());
    expect(sent).toHaveLength(1);
  });

  it('sends nothing when no summary address is configured', async () => {
    const { sent, finish } = makeHarness({ DAILY_SUMMARY_EMAIL: '' });

    await finish(saoPaulo('2026-09-28T16:17:00'), okRun([ALERT_A]));

    expect(sent).toHaveLength(0);
  });
});
