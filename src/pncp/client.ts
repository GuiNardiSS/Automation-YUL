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
}

const MAX_ATTEMPTS_PER_PAGE = 2;
const DEFAULT_MAX_PAGES = 1000;
// Kept modest (not the more generous default one might pick for a leisurely
// background job) because this now runs inside a GitHub Actions job billed
// by the minute: with 2 attempts per page and up to 3 UFs fetched
// sequentially, a full outage costs up to 2 * requestTimeoutMs * 3 of wasted
// CI time before the cycle gives up and moves on.
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

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

async function fetchPage(url: string, requestTimeoutMs: number): Promise<PncpPublicacaoResponse> {
  const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });

  if (!response.ok) {
    throw new PncpHttpError(response.status, await response.text());
  }

  return (await response.json()) as PncpPublicacaoResponse;
}

async function fetchPageWithRetry(url: string, requestTimeoutMs: number): Promise<PncpPublicacaoResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt++) {
    try {
      return await fetchPage(url, requestTimeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (error instanceof PncpHttpError && error.status < 500) {
        throw error;
      }
      // Otherwise retryable: 5xx, request timeout, or a network-level error.
    }
  }

  throw lastError;
}

export async function fetchAllContratacoes(params: FetchContratacoesParams): Promise<PncpContratacaoItem[]> {
  const items: PncpContratacaoItem[] = [];
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
  const requestTimeoutMs = params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let pagina = 1;

  while (true) {
    if (pagina > maxPages) {
      throw new Error(`PNCP pagination exceeded maxPages (${maxPages}) without reaching the last page`);
    }
    if (pagina > 1) {
      await sleep(params.requestDelayMs);
    }

    const page = await fetchPageWithRetry(buildUrl(params, pagina), requestTimeoutMs);
    items.push(...page.data);

    if (page.numeroPagina >= page.totalPaginas) {
      break;
    }
    pagina++;
  }

  return items;
}
