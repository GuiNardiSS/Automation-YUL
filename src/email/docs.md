# Noridoc: src/email

Path: @/src/email

### Overview

- Splits email concerns into pure content generation (`formatter.ts`) and I/O delivery (`sender.ts`, a nodemailer wrapper over Gmail SMTP).
- The formatter decides *what* an email says; the pipeline (`src/pipeline.ts`) decides *whether* to send one email per match or a single digest.

### How it fits into the larger codebase

- `src/pipeline.ts`'s `dispatchEmails` is the only caller of both `formatter.ts` and `sender.ts`: it picks `formatDigestEmail` when the new-match count exceeds `Config.emailDigestThreshold`, otherwise `formatSingleMatchEmail` per match, then calls `sendEmail` for each formatted result.
- `createTransport` is built once per run in `src/index.ts` from SMTP settings in `Config` (`src/config.ts`) and reused for every email sent within that run, rather than reconnecting per email. Since each GitHub Actions invocation is a fresh process (see the root `docs.md`), the transport itself is rebuilt on every run — there is no cross-run connection pooling.
- `scripts/send-test-email.ts` calls `createTransport`/`sendEmail` directly, independent of the pipeline, as a manual pre-go-live SMTP smoke test.

### Core Implementation

- `formatSingleMatchEmail`/`formatDigestEmail` build subject/text/html from a shared `tenderTextBlock`/`tenderHtmlBlock` renderer; `escapeHtml` guards the HTML variant against injection from tender fields sourced from PNCP (title, publisher, description, etc.), escaping `&`, `<`, `>`, `"`, and `'`. Every interpolated field in `tenderHtmlBlock`, including `link` inside the `<a href="...">` attribute, goes through `escapeHtml`.
- `sendEmail` logs `email.sent` (with the provider's `messageId`/`accepted` list) on success or `email.failed` on error via the winston logger passed in from `src/pipeline.ts`, then re-throws the error after logging it. It also checks `info.rejected` and logs an `email.partially_rejected` warning when nodemailer reports that some (but not all) comma-joined recipients were rejected by the SMTP server — this is a warning only, not a thrown error, so it does not trigger `src/pipeline.ts`'s `unmarkSeen`/retry path.

### Things to Know

- `sender.ts` has no unit tests by design — it's an I/O boundary, verified instead via `scripts/send-test-email.ts` (manual, real-SMTP smoke test) and by reading the `email.sent`/`email.failed`/`email.partially_rejected` log lines during a live run.
- Partial rejection is deliberately not treated as a failure worth retrying: nodemailer can resolve `sendMail` successfully even when some recipients were rejected, and retrying via the same `unmarkSeen`/resend path used for full failures would resend to the recipients who were already successfully accepted. For this project's small, static recipient list, an occasional silent partial failure (now at least visible in logs) was judged the lesser problem.
- `sendEmail` re-throws after logging; `src/pipeline.ts`'s shared `sendAndUnmarkOnFailure` helper (used by `dispatchEmails` for both the digest and individual-email paths) catches that per match (or once for a digest), calls `seenStore.unmarkSeen()` on the affected match(es), and — for the individual-email path — continues on to the remaining matches rather than aborting the whole cycle. This means one failed send doesn't block sibling matches in the same cycle, and the failed one itself is retried on the next scheduled run instead of being silently dropped — see `src/dedup/docs.md`.
- `EMAIL_DIGEST_THRESHOLD` (default 10, in `Config.emailDigestThreshold`) exists purely to avoid inbox flooding when a poll cycle turns up an unusually large batch of new matches; it switches the whole batch to one combined email instead of one email per tender.

Created and maintained by Nori.
