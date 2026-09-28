import { escapeHtml } from '../email/formatter.js';
import type { EmailContent } from '../email/sender.js';
import type { RunResult } from '../pipeline.js';

export type RecordedRun = { at: string; ok: true; result: RunResult } | { at: string; ok: false; error: string };

function formatDay(day: string): { short: string; full: string } {
  const [year, month, date] = day.split('-');
  return { short: `${date}/${month}`, full: `${date}/${month}/${year}` };
}

function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

export function formatDailySummaryEmail(day: string, runs: RecordedRun[], timezone: string): EmailContent {
  const { short, full } = formatDay(day);
  const failures = runs.filter((run): run is Extract<RecordedRun, { ok: false }> => !run.ok);
  const successes = runs.filter((run): run is Extract<RecordedRun, { ok: true }> => run.ok);
  const alerts = successes.flatMap((run) => run.result.alertsSent);
  const failedQueries = successes.reduce((total, run) => total + run.result.failedQueries, 0);
  const lastSuccess = successes.at(-1);
  // Every run re-fetches the whole lookback window, so summing across runs
  // would count the same tenders several times; the latest run is the honest number.
  const analyzed = lastSuccess ? lastSuccess.result.totalFetched.toLocaleString('pt-BR') : '—';

  const alertsLabel =
    alerts.length === 0 ? 'nenhum alerta novo' : `${alerts.length} ${alerts.length === 1 ? 'novo alerta' : 'novos alertas'}`;
  const subject = `[PNCP] Resumo diário ${short} — ${alertsLabel}`;

  const summaryLines = [
    `Resumo do monitor PNCP — ${full}`,
    '',
    `Execuções hoje: ${runs.length} (${failures.length} com falha)`,
    `Consultas ao PNCP com falha: ${failedQueries}`,
    `Licitações analisadas (última execução bem-sucedida): ${analyzed}`,
    `Alertas novos enviados hoje: ${alerts.length}`,
  ];
  const alertLines = alerts.length === 0 ? [] : ['', 'Alertas:', ...alerts.map((alert) => `- ${alert.title}\n  ${alert.link}`)];
  const failureLines =
    failures.length === 0 ? [] : ['', 'Falhas:', ...failures.map((run) => `- ${formatTime(run.at, timezone)} — ${run.error}`)];

  const html = [
    `<h2>Resumo do monitor PNCP — ${full}</h2>`,
    '<ul>',
    `<li><strong>Execuções hoje:</strong> ${runs.length} (${failures.length} com falha)</li>`,
    `<li><strong>Consultas ao PNCP com falha:</strong> ${failedQueries}</li>`,
    `<li><strong>Licitações analisadas (última execução bem-sucedida):</strong> ${analyzed}</li>`,
    `<li><strong>Alertas novos enviados hoje:</strong> ${alerts.length}</li>`,
    '</ul>',
    ...(alerts.length === 0
      ? []
      : [
          '<h3>Alertas</h3>',
          '<ul>',
          ...alerts.map(
            (alert) => `<li>${escapeHtml(alert.title)}<br><a href="${escapeHtml(alert.link)}">${escapeHtml(alert.link)}</a></li>`,
          ),
          '</ul>',
        ]),
    ...(failures.length === 0
      ? []
      : [
          '<h3>Falhas</h3>',
          '<ul>',
          ...failures.map((run) => `<li>${formatTime(run.at, timezone)} — ${escapeHtml(run.error)}</li>`),
          '</ul>',
        ]),
  ].join('\n');

  return { subject, text: [...summaryLines, ...alertLines, ...failureLines].join('\n'), html };
}
