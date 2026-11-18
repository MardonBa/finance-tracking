# Open items

Defaults and placeholders chosen while building autonomously. Each has a matching `TODO(revisit):` in the code. Confirm or change them, then delete the line.

## Phase 0 (foundation)

- **User time zone:** `USER_TIME_ZONE = "America/New_York"` in `apps/api/wrangler.toml` (dev and production). It decides "today" for queries and the cron. Set it to the real zone.
- **Daily sync time:** cron `0 11 * * *` (11:00 UTC) in `apps/api/wrangler.toml`; success-criteria §4 leaves this open.
- **Production Cloudflare resources:** the D1 id (`00000000-…`) and the R2 bucket `ft-backups-prod` in `apps/api/wrangler.toml` are placeholders. Create them in Phase 4 (`docs/shipping.md`).
- **Production secrets:** never set yet. In particular the production `PLAID_SECRET`, and fresh `TOKEN_ENC_KEY` / `BACKUP_ENC_KEY` / `APP_TOKEN_PEPPER` via `wrangler secret put --env production`.
- **`ALLOWED_GOOGLE_SUB` / `ALLOWED_GOOGLE_EMAIL`:** empty in `.env`; the backend track needs one of them to restrict sign-in to the user's account.
- **Orange and pink shades:** proposed values in `apps/desktop/src/ui/tokens.css` (§15 Open); they still need a WCAG AA contrast check.
- **Plaid webhook:** `/plaid/webhook` returns 501 until the backend track adds signature verification.
- **`scheduled()`:** a stub that does nothing yet (backend track).
- **Sandbox limits:** custom users only return about the last 30 days and can't simulate a pending charge posting. That case is covered by `user_transactions_dynamic` and the deterministic seed (`apps/api/seed/README.md`).
- **Dev auth:** the desktop app uses `DEV_APP_TOKEN` (dev builds only) until Google sign-in issues real app tokens.
- **Undo conflicts:** undoing an older action restores rows as they were before it, even if a later action changed the same rows. There is no conflict detection yet (`apps/api/src/routes/registry.ts`).

## Phase 1: backend

Resolved from Phase 0: the Plaid webhook is now verified and handled, `scheduled()` syncs, saves snapshots and backs up, and Google sign-in issues real app tokens. `DEV_APP_TOKEN` now only works when `ENVIRONMENT=dev`; `apps/api/.dev.vars` gets it from `npm run sync:dev-vars`.

- **App credential lifetime:** 90 days (`APP_TOKEN_TTL_DAYS`, `apps/api/src/auth.ts`). After that the app must sign in with Google again (§3 Open).
- **Sign-in allowlist:** `ALLOWED_GOOGLE_EMAIL` is set, `ALLOWED_GOOGLE_SUB` is empty. When both are set, both must match. Add your Google `sub` once known; it's stable even if the email changes.
- **Consent-expiry warning:** a bank is marked `pending_expiration` 7 days before `consent_expiration_time` (`CONSENT_WARNING_DAYS`, `apps/api/src/sync/status.ts`), and right away on Plaid's `PENDING_EXPIRATION` / `PENDING_DISCONNECT` webhooks.
- **Refresh rate limit:** Plaid gives no retry time, so after a rate-limited refresh we wait 1 hour (`REFRESH_BACKOFF_MS`, `apps/api/src/sync/refresh.ts`). Whether the Trial limits refresh at all is still open (§4); Sandbox showed no limit.
- **Trial limit count:** counts every item in `plaid_items` against 10 (`apps/api/src/connections/link.ts`). Plaid may also count items we dropped, e.g. a discarded duplicate: `/item/remove` is deliberately not on the read-only allowlist, so a discarded duplicate stays at Plaid.
- **Duplicate "keep":** saves the new bank with the matching accounts **hidden**, so they never count twice. The UI may want a per-account choice.
- **One bank per Link session:** extra `item_add_results` (multi-item Link) are ignored.
- **Backups:** weekly, Sundays 12:00 UTC (`0 12 * * SUN`), newest 12 kept (`BACKUP_RETENTION`). Open in §2: also keeping a copy outside Cloudflare.
- **`PUBLIC_API_URL`:** `http://localhost:8787` in dev and a placeholder in production (`apps/api/wrangler.toml`). Set dev to the deployed dev Worker's https URL to receive Plaid webhooks (local `wrangler dev` can't). Set production in Phase 4.
- **Free-plan limits on a first import:** sync writes in bulk (`json_each`) and commits per page, but a real 24-month import hasn't been measured against the Workers Free plan's 10 ms CPU and per-invocation query limits (`apps/api/src/db/bulk.ts`). An interrupted run resumes from the saved cursor.
- **Seams for the core tracks:** `apps/api/src/sync/hooks.ts` (`afterTransactionsSynced` for classification and transfer matching, `afterDailySnapshots` for rebuild and downsampling) are no-ops until core-flows and core-balances wire them up. Manual accounts are snapshotted from `current_balance_cents`; computing that balance from their transactions belongs to core.
- **Manual checks (user):** Hosted Link in a browser with Sandbox `user_good`/`pass_good`, the Platypus OAuth Bank, cancelling partway, and webhook delivery to a deployed dev Worker (`docs/planning/plaid-hosted-link-spike.md`). Also a real restore into a fresh remote database (`docs/backup-restore.md`), and Google sign-in with a non-allowed account (should get 403).
