# Noridoc: src/pncp

Path: @/src/pncp

### Overview

- Everything related to talking to PNCP's real HTTP API: the raw response types (`types.ts`), the paginated fetcher (`client.ts`), and the pure mapper from raw PNCP shape to the app's internal `TenderMatch` (`mapper.ts`).
- The raw types in `types.ts` are an unverified hypothesis, explicitly flagged as such in the file itself, pending manual confirmation against the live API.

### How it fits into the larger codebase

- `src/pipeline.ts` is the only caller of `fetchAllContratacoes` and `toTenderMatchesSafely`, invoked once per configured UF (`Config.pncpUfs`, from `src/config.ts`) per cron cycle.
- `mapper.ts`'s output (`TenderMatch`, defined in `src/domain/tender.ts`) is what everything downstream — `src/filters/`, `src/dedup/`, `src/email/` — actually operates on. Nothing outside this folder should reference `PncpContratacaoItem` directly.
- `scripts/verify-api.ts` makes standalone requests against the same live endpoint (`/v1/contratacoes/publicacao`) used by `client.ts`, for manual comparison against `types.ts` — it does not share code with `client.ts` beyond the `undici` import pattern.

### Core Implementation

- `fetchAllContratacoes` pages through `/v1/contratacoes/publicacao` until `numeroPagina >= totalPaginas`, sleeping `requestDelayMs` between page requests (not before the first one) to avoid hammering the API. It also takes an optional `maxPages` (default `DEFAULT_MAX_PAGES = 1000`); once `pagina` exceeds it, the function throws instead of continuing to loop, guarding against the (unverified, see Task 0) assumption that `numeroPagina`/`totalPaginas` will ever actually converge.
- `fetchPageWithRetry` retries a failed page fetch at most once (2 total attempts) and only for 5xx responses; any 4xx response throws immediately without retrying.
- `toTenderMatch` builds the public tender URL from `orgaoEntidade.cnpj`, `anoCompra`, and `sequencialCompra` (`https://pncp.gov.br/app/editais/{cnpj}/{ano}/{sequencial}`), and currently maps both `title` and `description` on `TenderMatch` from the same source field, `objetoCompra`. It throws if a raw item doesn't have the expected shape (e.g. a missing `orgaoEntidade`).
- `toTenderMatchesSafely(items, onSkip?)` is the mapper entry point actually called by `src/pipeline.ts`: it calls `toTenderMatch` per item inside a try/catch, pushing successes into the result array and reporting failures to the optional `onSkip(item, error)` callback instead of letting one bad item throw and abort mapping for the whole batch.

### Things to Know

- **`client.ts` imports `fetch` from the `undici` npm package, not the global `fetch`.** Node's built-in global `fetch` is backed by an internal, unexported undici instance that `MockAgent`/`setGlobalDispatcher` (used in `tests/pncp/client.test.ts`) cannot intercept. `undici` is listed in `dependencies` (not devDependencies) specifically so production code and test mocking share the same dispatcher registry. Any new PNCP (or other HTTP) code in this project must import `fetch` from `undici` the same way, or its tests will silently attempt real network calls instead of hitting the mock.
- **Task 0: run `npm run verify-api` before trusting anything in `types.ts`.** The shapes here were reverse-engineered from an official manual PDF, blog posts, and a GitHub gist — not confirmed against a live response. `scripts/verify-api.ts` checks specifically whether `codigoModalidadeContratacao` is required, exact field names/nesting, actual default/max `tamanhoPagina`, and whether server-side `uf` filtering is reliable. The pagination `maxPages` cap and `toTenderMatchesSafely`'s per-item isolation both exist specifically to contain the blast radius if that hypothesis turns out to be wrong, without needing this doc (or the code) revisited once Task 0 is done.
- The retry policy (one retry, 5xx only) is deliberately minimal — the system already gets a natural retry every 5 minutes via the cron cycle, so no exponential backoff or multi-retry logic was added.
- `codigoModalidadeContratacao` is an optional query param on `FetchContratacoesParams`, but as of now `src/pipeline.ts` never sets it — see `src/docs.md` for the related unused `Config.pncpModalidadeCodes` field.

Created and maintained by Nori.
