import RedisMock from 'ioredis-mock';
import { MockAgent, setGlobalDispatcher } from 'undici';
import winston from 'winston';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { RedisSeenStore } from '../src/dedup/redisStore.js';
import { runOnce, shouldDigest } from '../src/pipeline.js';

describe('shouldDigest', () => {
  it('is false when the match count is at or below the threshold', () => {
    expect(shouldDigest(10, 10)).toBe(false);
    expect(shouldDigest(5, 10)).toBe(false);
  });

  it('is true when the match count exceeds the threshold', () => {
    expect(shouldDigest(11, 10)).toBe(true);
  });
});

const ORIGIN = 'https://pncp.example.test';
const PATH_PREFIX = '/api/consulta/v1/contratacoes/publicacao';

const audiovisualTender = {
  numeroControlePNCP: '12250999000106-1-000014/2026',
  objetoCompra: 'Contratação de empresa para produção audiovisual do evento institucional.',
  dataPublicacaoPncp: '2026-09-23T10:00:00',
  modalidadeNome: 'Pregão - Eletrônico',
  anoCompra: 2026,
  sequencialCompra: 14,
  orgaoEntidade: { cnpj: '12250999000106', razaoSocial: 'Fundação Cultural de Florianópolis' },
  unidadeOrgao: { nomeUnidade: 'Diretoria de Eventos', municipioNome: 'Florianópolis', ufSigla: 'SC' },
};

function query(path: string): URLSearchParams {
  return new URLSearchParams(path.split('?')[1] ?? '');
}

function makeDeps() {
  const config = loadConfig({
    SMTP_USER: 'alerts@example.com',
    SMTP_APP_PASSWORD: 'app-password',
    RECIPIENT_EMAILS: 'client@example.com',
    REDIS_URL: 'redis://unused',
    PNCP_API_BASE_URL: `${ORIGIN}/api/consulta`,
    PNCP_UFS: 'SC',
    PNCP_MODALIDADE_CODES: '6,8',
    PNCP_REQUEST_DELAY_MS: '0',
  });
  const sent: Array<{ text: string }> = [];
  const emailTransport = {
    sendMail: async (message: { text: string }) => {
      sent.push(message);
      return { messageId: 'id', accepted: ['client@example.com'], rejected: [] };
    },
  };
  return {
    sent,
    deps: {
      config,
      logger: winston.createLogger({ silent: true }),
      seenStore: new RedisSeenStore(new RedisMock() as any, 60),
      emailTransport: emailTransport as any,
    },
  };
}

describe('runOnce', () => {
  let mockAgent: MockAgent;

  beforeEach(async () => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    // ioredis-mock instances share one in-memory store, so a tender marked
    // "seen" by an earlier test would otherwise suppress this test's email.
    await new RedisMock().flushall();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it('emails an audiovisual tender found under one of the configured modalities', async () => {
    // Mirrors the real PNCP API: the modality code is a required parameter
    // (400 without it) and a modality with no results answers 204 with no body.
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: (p) => p.startsWith(PATH_PREFIX) && !query(p).has('codigoModalidadeContratacao'), method: 'GET' })
      .reply(400, { message: "Required request parameter 'codigoModalidadeContratacao' is not present" })
      .persist();
    client
      .intercept({ path: (p) => p.startsWith(PATH_PREFIX) && query(p).get('codigoModalidadeContratacao') === '6', method: 'GET' })
      .reply(200, { data: [audiovisualTender], totalRegistros: 1, totalPaginas: 1, numeroPagina: 1, paginasRestantes: 0, empty: false });
    client
      .intercept({ path: (p) => p.startsWith(PATH_PREFIX) && query(p).get('codigoModalidadeContratacao') === '8', method: 'GET' })
      .reply(204, '');

    const { deps, sent } = makeDeps();
    await runOnce(deps);

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('https://pncp.gov.br/app/editais/12250999000106/2026/14');
  });

  it('fails the run instead of finishing silently when every PNCP request fails', async () => {
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: (p) => p.startsWith(PATH_PREFIX), method: 'GET' })
      .reply(500, { message: 'server error' })
      .persist();

    const { deps, sent } = makeDeps();

    await expect(runOnce(deps)).rejects.toThrow(/PNCP/);
    expect(sent).toHaveLength(0);
  });

  it('gives up early instead of querying every modality when PNCP looks down', async () => {
    let requestsReceived = 0;
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({
        path: (p) => {
          const matches = p.startsWith(PATH_PREFIX);
          if (matches) requestsReceived++;
          return matches;
        },
        method: 'GET',
      })
      .reply(500, { message: 'server error' })
      .persist();

    const { deps } = makeDeps();
    const tenModalities = { ...deps, config: { ...deps.config, pncpModalidadeCodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } };

    await expect(runOnce(tenModalities)).rejects.toThrow(/PNCP/);
    // A full sweep would be 10 queries x 2 attempts = 20 requests. Stopping
    // early keeps an outage from burning the CI job's whole time budget.
    expect(requestsReceived).toBeLessThanOrEqual(10);
  });

  it('still emails what it found when only some PNCP requests fail', async () => {
    const client = mockAgent.get(ORIGIN);
    client
      .intercept({ path: (p) => p.startsWith(PATH_PREFIX) && query(p).get('codigoModalidadeContratacao') === '6', method: 'GET' })
      .reply(200, { data: [audiovisualTender], totalRegistros: 1, totalPaginas: 1, numeroPagina: 1, paginasRestantes: 0, empty: false });
    client
      .intercept({ path: (p) => p.startsWith(PATH_PREFIX) && query(p).get('codigoModalidadeContratacao') === '8', method: 'GET' })
      .reply(500, { message: 'server error' })
      .persist();

    const { deps, sent } = makeDeps();
    await runOnce(deps);

    expect(sent).toHaveLength(1);
  });

  it('does not fail the run when every configured modality simply has no results', async () => {
    const client = mockAgent.get(ORIGIN);
    client.intercept({ path: (p) => p.startsWith(PATH_PREFIX), method: 'GET' }).reply(204, '').persist();

    const { deps, sent } = makeDeps();

    await expect(runOnce(deps)).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});
