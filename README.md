# PNCP Audiovisual Tender Monitor

Polls PNCP (Portal Nacional de Contratações Públicas) every 5 minutes during business hours
(08:00–18:00, America/Sao_Paulo) for tenders in SC, PR, and RS matching audiovisual-related
keywords, and emails alerts for new matches.

## Setup

```bash
npm install
cp .env.example .env   # fill in SMTP_USER, SMTP_APP_PASSWORD, RECIPIENT_EMAILS
docker-compose up -d   # local Redis for development
```

## Task 0 — verify the PNCP API before trusting this codebase's assumptions

`src/pncp/types.ts` and `src/pncp/client.ts` were written from secondary sources (the official
PNCP API manual PDF, blog writeups, a GitHub gist) because live API calls weren't reachable
during development. Run this first and compare the real response against `src/pncp/types.ts`:

```bash
npm run verify-api
```

## Development

```bash
npm test          # run the test suite
npm run build      # compile TypeScript
npm start           # run the compiled entrypoint
```

## Manual verification before go-live

```bash
npm run send-test-email   # confirm real Gmail SMTP credentials work
```

Then run the full process (`npm start`) and check `./logs/app-*.log` for the four logging
checkpoints: `pncp.request`/`pncp.response`, `filter.summary`, `email.draft`, `email.sent`.
