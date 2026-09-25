import { fetch } from 'undici';
import type { PncpContratacaoItem, PncpPublicacaoResponse } from './types.js';

export interface FetchContratacoesParams {
  baseUrl: string;
  dataInicial: string;
  dataFinal: string;
  uf: string;
  pageSize: number;
  requestDelayMs: number;
  codigoModalidadeContratacao?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  rateLimitBackoffMs?: number;
}

const MAX_ATTEMPTS_PER_PAGE = 2;
const DEFAULT_MAX_PAGES = 1000;
// Kept modest because this runs inside a GitHub Actions job billed by the
// minute: every page can spend up to 2 * requestTimeoutMs during an outage
// before the query gives up.
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
// PNCP answers 429 after ~9 rapid requests and stays blocked for roughly
// 20-30s, without sending a Retry-After header (measured against the live
// API). Waiting past the top of that range avoids a second 429 on retry.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 40000;
const HTTP_NO_CONTENT = 204;
const HTTP_TOO_MANY_REQUESTS = 429;

class PncpHttpError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`PNCP request failed with status ${status}: ${body}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(params: FetchContratacoesParams, pagina: number): string {
  const query = new URLSearchParams({
    uf: params.uf,
    dataInicial: params.dataInicial,
    dataFinal: params.dataFinal,
    pagina: String(pagina),
    tamanhoPagina: String(params.pageSize),
  });
  if (params.codigoModalidadeContratacao !== undefined) {
    query.set('codigoModalidadeContratacao', String(params.codigoModalidadeContratacao));
  }
  return `${params.baseUrl}/v1/contratacoes/publicacao?${query.toString()}`;
}

// Resolves null when PNCP has no results for the query: it answers 204 with an
// empty body rather than an empty `data` array.
async function fetchPage(url: string, requestTimeoutMs: number): Promise<PncpPublicacaoResponse | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });

  if (!response.ok) {
    throw new PncpHttpError(response.status, await response.text());
  }
  if (response.status === HTTP_NO_CONTENT) {
    return null;
  }

  return (await response.json()) as PncpPublicacaoResponse;
}

async function fetchPageWithRetry(
  url: string,
  requestTimeoutMs: number,
  rateLimitBackoffMs: number,
): Promise<PncpPublicacaoResponse | null> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt++) {
    try {
      return await fetchPage(url, requestTimeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRateLimited = error instanceof PncpHttpError && error.status === HTTP_TOO_MANY_REQUESTS;
      if (error instanceof PncpHttpError && error.status < 500 && !isRateLimited) {
        throw error;
      }
      if (isRateLimited && attempt < MAX_ATTEMPTS_PER_PAGE) {
        await sleep(rateLimitBackoffMs);
      }
      // Otherwise retryable: 429, 5xx, request timeout, or a network-level error.
    }
  }

  throw lastError;
}

export async function fetchAllContratacoes(params: FetchContratacoesParams): Promise<PncpContratacaoItem[]> {
  const items: PncpContratacaoItem[] = [];
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
  const requestTimeoutMs = params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const rateLimitBackoffMs = params.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
  let pagina = 1;

  while (true) {
    if (pagina > maxPages) {
      throw new Error(`PNCP pagination exceeded maxPages (${maxPages}) without reaching the last page`);
    }
    if (pagina > 1) {
      await sleep(params.requestDelayMs);
    }

    const page = await fetchPageWithRetry(buildUrl(params, pagina), requestTimeoutMs, rateLimitBackoffMs);
    if (!page) {
      break;
    }
    items.push(...page.data);

    if (page.numeroPagina >= page.totalPaginas) {
      break;
    }
    pagina++;
  }

  return items;
}
