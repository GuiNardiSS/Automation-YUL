// Task 0 — run this manually against the live PNCP API before trusting anything
// in src/pncp/types.ts or src/pncp/client.ts. See the plan's "Task 0" section
// for what to check: whether codigoModalidadeContratacao is really required,
// exact field names/nesting, actual default/max tamanhoPagina, and whether
// server-side uf filtering is reliable.
import 'dotenv/config';
import { fetch } from 'undici';

const baseUrl = process.env.PNCP_API_BASE_URL ?? 'https://pncp.gov.br/api/consulta';
const today = new Date();
const dataFinal = today.toISOString().slice(0, 10).replace(/-/g, '');
const dataInicial = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10)
  .replace(/-/g, '');

async function tryRequest(label: string, query: Record<string, string>): Promise<void> {
  const url = `${baseUrl}/v1/contratacoes/publicacao?${new URLSearchParams(query).toString()}`;
  console.log(`\n=== ${label} ===`);
  console.log(`GET ${url}`);
  try {
    const response = await fetch(url);
    console.log(`Status: ${response.status}`);
    const body = await response.text();
    console.log(body.slice(0, 4000));
  } catch (error) {
    console.log('Request failed:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  await tryRequest('Without codigoModalidadeContratacao', {
    uf: 'SC',
    dataInicial,
    dataFinal,
    pagina: '1',
    tamanhoPagina: '10',
  });

  await tryRequest('With codigoModalidadeContratacao=6 (Pregão Eletrônico)', {
    uf: 'SC',
    dataInicial,
    dataFinal,
    pagina: '1',
    tamanhoPagina: '10',
    codigoModalidadeContratacao: '6',
  });
}

main();
