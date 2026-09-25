# Noridoc: src/pncp

Path: @/src/pncp

### Overview

- Everything related to talking to PNCP's real HTTP API: the raw response types (`types.ts`), the paginated fetcher (`client.ts`), and the pure mapper from raw PNCP shape to the app's internal `TenderMatch` (`mapper.ts`).
- `types.ts` declares only the fields this project reads (the live response carries many more); those fields were verified against the live `/v1/contratacoes/publicacao` response on 2026-09-25.

### How it fits into the larger codebase

- `src/pipeline.ts` is the only caller of `fetchAllContratacoes` and `toTenderMatchesSafely`. It calls `fetchAllContratacoes` once per UF × modality code (`Config.pncpUfs` × `Config.pncpModalidadeCodes`, from `src/config.ts`) per run, pacing those calls itself, and decides whether the run as a whole failed — see `src/docs.md`.
- `mapper.ts`'s output (`TenderMatch`, defined in `src/domain/tender.ts`) is what everything downstream — `src/filters/`, `src/dedup/`, `src/email/` — actually operates on. Nothing outside this folder should reference `PncpContratacaoItem` directly.
- `scripts/verify-api.ts` is a standalone debugging script that hits the same live endpoint with and without a modality code and prints the raw responses; it does not share code with `client.ts` beyond the `undici` import pattern.

### Core Implementation

- **Live-API behaviors the client is built around** (measured directly against PNCP):

| PNCP behavior | How `client.ts` handles it |
|---|---|
| `codigoModalidadeContratacao` is required; HTTP 400 without it | It is optional on `FetchContratacoesParams`, but `src/pipeline.ts` always sets it |
| A query with no results returns HTTP 204 with an empty body (not `{data: []}`) | `fetchPage` returns `null` on 204 instead of calling `response.json()`; `fetchAllContratacoes` treats `null` as "no results", stops paginating, and returns what it has |
| ~9 rapid requests trigger HTTP 429 (an HTML "Limite de requisições excedido" page, no `Retry-After`), blocking for roughly 20–30 s | 429 is retryable: the client waits `rateLimitBackoffMs` (default `DEFAULT_RATE_LIMIT_BACKOFF_MS = 40000`, safely past the measured block) before the retry |

- `fetchAllContratacoes` pages through the endpoint until `numeroPagina >= totalPaginas` (or a 204), sleeping `requestDelayMs` between page requests (not before the first). An optional `maxPages` (default `DEFAULT_MAX_PAGES = 1000`) makes it throw instead of looping forever if the pagination fields never converge.
- `fetchPageWithRetry` allows at most `MAX_ATTEMPTS_PER_PAGE = 2` attempts. Retry classification:

| Failure | Behavior |
|---|---|
| HTTP 429 | Sleep `rateLimitBackoffMs`, then retry; a second 429 rejects |
| HTTP 5xx, request timeout, network error | Retry immediately (no backoff) |
| Any other 4xx | Thrown immediately, no retry |

- `PncpHttpError` (holding the HTTP `status` and response body) is what lets `fetchPageWithRetry` distinguish those cases. `fetchPage` passes `signal: AbortSignal.timeout(requestTimeoutMs)` (default `DEFAULT_REQUEST_TIMEOUT_MS = 15000`) so a stalled request becomes a retryable failure instead of hanging indefinitely.
- `toTenderMatch` builds the public tender URL from `orgaoEntidade.cnpj`, `anoCompra`, and `sequencialCompra` (`https://pncp.gov.br/app/editais/{cnpj}/{ano}/{sequencial}`), and maps both `title` and `description` on `TenderMatch` from the same source field, `objetoCompra`. It throws if a raw item doesn't have the expected shape (e.g. a missing `orgaoEntidade`).
- `toTenderMatchesSafely(items, onSkip?)` is the mapper entry point called by `src/pipeline.ts`: it calls `toTenderMatch` per item inside a try/catch and reports failures to the optional `onSkip(item, error)` callback instead of letting one bad item abort mapping for the whole batch.

### Things to Know

- **`client.ts` imports `fetch` from the `undici` npm package, not the global `fetch`.** Node's built-in global `fetch` is backed by an internal, unexported undici instance that `MockAgent`/`setGlobalDispatcher` (used in `tests/pncp/client.test.ts` and `tests/pipeline.test.ts`) cannot intercept. `undici` is listed in `dependencies` specifically so production code and test mocking share the same dispatcher registry. Any new HTTP code in this project must import `fetch` from `undici` the same way, or its tests will silently attempt real network calls.
- Before the 204 and 429 handling existed, an empty modality made `response.json()` throw on the empty body, and a rate-limited request was treated as a permanent 4xx failure; together with the missing modality code, the deployed pipeline fetched zero tenders on every run.
- Rate limiting is primarily avoided by pacing (`Config.pncpRequestDelayMs`, default 6000 ms, applied both between queries in `src/pipeline.ts` and between pages here); the 429 backoff is the fallback. A persistent 429 still rejects after two attempts, which `src/pipeline.ts` logs as one failed query rather than aborting the run.
- The retry policy is deliberately minimal (no exponential backoff, no multi-retry) — the next scheduled GitHub Actions run is the natural broader retry, and the lookback window re-covers the same day.
- **Worst-case run time scales with the number of queries and pages.** With two attempts per page, each page can spend up to `2 * requestTimeoutMs` (or `rateLimitBackoffMs` plus a request) during an outage, and queries run sequentially. `src/pipeline.ts` aborts the run after 3 consecutive failed queries, so a full PNCP outage fails fast instead of outlasting the workflow's `timeout-minutes`.

Created and maintained by Nori.
