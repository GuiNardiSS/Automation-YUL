import { MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchAllContratacoes } from '../../src/pncp/client.js';
import type { PncpPublicacaoResponse } from '../../src/pncp/types.js';

const ORIGIN = 'https://pncp.example.test';
const BASE_URL = `${ORIGIN}/api/consulta`;
const PATH_PREFIX = '/api/consulta/v1/contratacoes/publicacao';

function page(items: unknown[], numeroPagina: number, totalPaginas: number): PncpPublicacaoResponse {
  return {
    data: items as any,
    totalRegistros: items.length,
    totalPaginas,
    numeroPagina,
    paginasRestantes: totalPaginas - numeroPagina,
    empty: items.length === 0,
  };
}

function pathWithQuery(query: Record<string, string>): (path: string) => boolean {
  return (path: string) => {
    if (!path.startsWith(PATH_PREFIX)) return false;
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    return Object.entries(query).every(([key, value]) => params.get(key) === value);
  };
}

const baseParams = {
  baseUrl: BASE_URL,
  dataInicial: '20260101',
  dataFinal: '20260102',
  uf: 'SC',
  pageSize: 2,
  requestDelayMs: 0,
  requestTimeoutMs: 200,
  rateLimitBackoffMs: 0,
};

let mockAgent: MockAgent;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  await mockAgent.close();
});

describe('fetchAllContratacoes', () => {
  it('aggregates items across multiple pages into a single flat array', async () => {
    const itemA = { numeroControlePNCP: 'a' };
    const itemB = { numeroControlePNCP: 'b' };
    const itemC = { numeroControlePNCP: 'c' };
    const client = mockAgent.get(ORIGIN);

    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(200, page([itemA, itemB], 1, 2));
    client.intercept({ path: pathWithQuery({ pagina: '2' }), method: 'GET' }).reply(200, page([itemC], 2, 2));

    const result = await fetchAllContratacoes(baseParams);

    expect(result).toEqual([itemA, itemB, itemC]);
  });

  it('returns an empty array when the first page is already empty', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(200, page([], 1, 1));

    const result = await fetchAllContratacoes(baseParams);

    expect(result).toEqual([]);
  });

  it('sends the uf, date range, page number, and page size as query parameters', async () => {
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({
        path: pathWithQuery({
          uf: 'SC',
          dataInicial: '20260101',
          dataFinal: '20260102',
          pagina: '1',
          tamanhoPagina: '2',
        }),
        method: 'GET',
      })
      .reply(200, page([], 1, 1));

    // If any param were wrong, undici would throw a "no matching interceptor"
    // error and this await would reject, failing the test.
    await expect(fetchAllContratacoes(baseParams)).resolves.toEqual([]);
  });

  it('returns an empty array when PNCP answers 204 No Content for a query with no results', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(204, '');

    await expect(fetchAllContratacoes(baseParams)).resolves.toEqual([]);
  });

  it('retries after being rate limited (429) instead of treating it as a permanent client error', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(429, 'Limite de requisições excedido');
    client
      .intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' })
      .reply(200, page([{ numeroControlePNCP: 'a' }], 1, 1));

    await expect(fetchAllContratacoes(baseParams)).resolves.toEqual([{ numeroControlePNCP: 'a' }]);
  });

  it('waits before retrying a rate-limited (429) request so the retry is not rate limited again', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(429, 'Limite de requisições excedido');
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(200, page([], 1, 1));

    const startedAt = Date.now();
    await fetchAllContratacoes({ ...baseParams, rateLimitBackoffMs: 300 });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
  });

  it('gives up with an error when PNCP keeps rate limiting every attempt', async () => {
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' })
      .reply(429, 'Limite de requisições excedido')
      .persist();

    await expect(fetchAllContratacoes(baseParams)).rejects.toThrow(/429/);
  }, 3000);

  it('throws immediately without retrying on a 4xx client error', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(400, { message: 'bad request' });
    // A second interceptor that only a retry would consume.
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(200, page([], 1, 1));

    await expect(fetchAllContratacoes(baseParams)).rejects.toThrow(/400/);
    expect(mockAgent.pendingInterceptors()).toHaveLength(1);
  });

  it('retries once on a 5xx server error and succeeds if the retry works', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' }).reply(503, { message: 'temporarily unavailable' });
    client
      .intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' })
      .reply(200, page([{ numeroControlePNCP: 'a' }], 1, 1));

    const result = await fetchAllContratacoes(baseParams);

    expect(result).toEqual([{ numeroControlePNCP: 'a' }]);
  });

  it('throws after exhausting a single retry on repeated 5xx server errors', async () => {
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: pathWithQuery({ pagina: '1' }), method: 'GET' })
      .reply(500, { message: 'server error' })
      .times(2);

    await expect(fetchAllContratacoes(baseParams)).rejects.toThrow(/500/);
  });

  it('stops and throws instead of looping forever if the server never reports the last page', async () => {
    // Simulates a server that always claims there are more pages than it will
    // ever actually deliver (or a numeroPagina/totalPaginas schema mismatch,
    // which src/pncp/types.ts flags as unverified pending live-API testing).
    // Without a hard cap this would loop until the process runs out of memory
    // or the scheduled run stalls forever.
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: pathWithQuery({}), method: 'GET' })
      .reply(200, page([{ numeroControlePNCP: 'a' }], 1, 1_000_000))
      .persist();

    await expect(fetchAllContratacoes({ ...baseParams, maxPages: 3 })).rejects.toThrow(/exceeded.*maxPages/i);
  });

  it('gives up and throws instead of hanging forever when PNCP never responds', async () => {
    // Found via a real smoke test: a GitHub Actions job billed by the minute
    // must not hang indefinitely waiting on a stalled PNCP response. Delays
    // the reply well beyond requestTimeoutMs (200ms) to simulate that.
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: pathWithQuery({}), method: 'GET' })
      .reply(200, page([], 1, 1))
      .delay(5000)
      .persist();

    await expect(fetchAllContratacoes(baseParams)).rejects.toThrow(/timeout/i);
  }, 3000);
});
