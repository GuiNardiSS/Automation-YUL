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
}

const MAX_ATTEMPTS_PER_PAGE = 2;
const DEFAULT_MAX_PAGES = 1000;

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

async function fetchPageWithRetry(url: string): Promise<PncpPublicacaoResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt++) {
    const response = await fetch(url);

    if (response.ok) {
      return (await response.json()) as PncpPublicacaoResponse;
    }

    lastError = new Error(`PNCP request failed with status ${response.status}: ${await response.text()}`);

    if (response.status < 500) {
      throw lastError;
    }
  }

  throw lastError;
}

export async function fetchAllContratacoes(params: FetchContratacoesParams): Promise<PncpContratacaoItem[]> {
  const items: PncpContratacaoItem[] = [];
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
  let pagina = 1;

  while (true) {
    if (pagina > maxPages) {
      throw new Error(`PNCP pagination exceeded maxPages (${maxPages}) without reaching the last page`);
    }
    if (pagina > 1) {
      await sleep(params.requestDelayMs);
    }

    const page = await fetchPageWithRetry(buildUrl(params, pagina));
    items.push(...page.data);

    if (page.numeroPagina >= page.totalPaginas) {
      break;
    }
    pagina++;
  }

  return items;
}
