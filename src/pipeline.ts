import type winston from 'winston';
import type { Config } from './config.js';
import type { RedisSeenStore } from './dedup/redisStore.js';
import { createTransport, sendEmail } from './email/sender.js';
import { formatDigestEmail, formatSingleMatchEmail } from './email/formatter.js';
import { filterAudiovisualTenders } from './filters/index.js';
import { toTenderMatchesSafely } from './pncp/mapper.js';
import { fetchAllContratacoes } from './pncp/client.js';
import type { TenderMatch } from './domain/tender.js';

export interface PipelineDeps {
  config: Config;
  logger: winston.Logger;
  seenStore: RedisSeenStore;
  emailTransport: ReturnType<typeof createTransport>;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// Several failures in a row means PNCP itself is down, not one bad query.
// Without stopping here an outage (timeouts, repeated 429s) runs every
// remaining query and outlasts the CI job's timeout, billing all of it.
const MAX_CONSECUTIVE_PNCP_FAILURES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllRawItems(deps: PipelineDeps, cycleId: string) {
  const dataFinal = formatDate(new Date());
  const dataInicial = formatDate(new Date(Date.now() - deps.config.pncpLookbackDays * 24 * 60 * 60 * 1000));
  const rawItems = [];
  let attempted = 0;
  let succeeded = 0;
  let consecutiveFailures = 0;

  // PNCP requires codigoModalidadeContratacao on this endpoint (HTTP 400
  // without it), so every UF has to be queried once per modality.
  for (const uf of deps.config.pncpUfs) {
    for (const modalidade of deps.config.pncpModalidadeCodes) {
      if (attempted > 0) {
        await sleep(deps.config.pncpRequestDelayMs);
      }
      attempted++;
      deps.logger.info('pncp.request', { cycleId, uf, modalidade, dataInicial, dataFinal });
      try {
        const items = await fetchAllContratacoes({
          baseUrl: deps.config.pncpApiBaseUrl,
          uf,
          codigoModalidadeContratacao: modalidade,
          dataInicial,
          dataFinal,
          pageSize: deps.config.pncpPageSize,
          requestDelayMs: deps.config.pncpRequestDelayMs,
        });
        succeeded++;
        consecutiveFailures = 0;
        deps.logger.info('pncp.response', { cycleId, uf, modalidade, itemCount: items.length });
        rawItems.push(...items);
      } catch (error) {
        consecutiveFailures++;
        deps.logger.error('pncp.error', {
          cycleId,
          uf,
          modalidade,
          error: error instanceof Error ? error.message : String(error),
        });
        if (consecutiveFailures >= MAX_CONSECUTIVE_PNCP_FAILURES) {
          throw new Error(`PNCP appears to be down: ${consecutiveFailures} consecutive requests failed, aborting run`);
        }
      }
    }
  }

  if (attempted > 0 && succeeded === 0) {
    throw new Error(`All ${attempted} PNCP requests failed this run`);
  }

  return rawItems;
}

async function selectNewMatches(deps: PipelineDeps, matches: TenderMatch[]): Promise<TenderMatch[]> {
  const newMatches: TenderMatch[] = [];
  for (const match of matches) {
    if (await deps.seenStore.markIfNew(match.id)) {
      newMatches.push(match);
    }
  }
  return newMatches;
}

export function shouldDigest(matchCount: number, threshold: number): boolean {
  return matchCount > threshold;
}

// Matches are marked "seen" (selectNewMatches) before we know whether the email
// will actually go out. If a send fails, we unmark it here so the next scheduled
// run retries — the alternative (leaving it marked) would silently drop
// the tender's notification forever, which defeats the entire point of this
// system for a case (transient SMTP failure) that's likely to resolve itself.
async function sendAndUnmarkOnFailure(
  deps: PipelineDeps,
  content: { subject: string; text: string; html: string },
  matchesToUnmarkOnFailure: TenderMatch[],
  logContext: Record<string, unknown>,
): Promise<void> {
  try {
    await sendEmail(deps.emailTransport, deps.config, content, deps.logger, logContext);
  } catch {
    await Promise.all(matchesToUnmarkOnFailure.map((match) => deps.seenStore.unmarkSeen(match.id)));
  }
}

async function dispatchEmails(deps: PipelineDeps, cycleId: string, newMatches: TenderMatch[]): Promise<void> {
  if (shouldDigest(newMatches.length, deps.config.emailDigestThreshold)) {
    const content = formatDigestEmail(newMatches);
    deps.logger.info('email.draft', { cycleId, kind: 'digest', count: newMatches.length, subject: content.subject });
    await sendAndUnmarkOnFailure(deps, content, newMatches, { cycleId, kind: 'digest' });
    return;
  }

  for (const match of newMatches) {
    const content = formatSingleMatchEmail(match);
    deps.logger.info('email.draft', { cycleId, tenderId: match.id, subject: content.subject });
    await sendAndUnmarkOnFailure(deps, content, [match], { cycleId, tenderId: match.id });
  }
}

export async function runOnce(deps: PipelineDeps): Promise<void> {
  const cycleId = new Date().toISOString();

  const rawItems = await fetchAllRawItems(deps, cycleId);
  const mappedTenders = toTenderMatchesSafely(rawItems, (item, error) => {
    deps.logger.error('pncp.mapping_error', { cycleId, itemId: item.numeroControlePNCP, error: error.message });
  });
  const allMatches = filterAudiovisualTenders(mappedTenders);

  deps.logger.info('filter.summary', {
    cycleId,
    totalFetched: rawItems.length,
    matchedFilters: allMatches.length,
  });

  const newMatches = await selectNewMatches(deps, allMatches);

  if (newMatches.length === 0) {
    return;
  }

  await dispatchEmails(deps, cycleId, newMatches);
}
