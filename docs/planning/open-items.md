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

## Phase 1: core-balances

- **Daily detail window:** snapshots older than 90 days are reduced to one per week (`DAILY_DETAIL_DAYS`, `packages/core/src/balances/snapshots.ts`); §5 Open.
- **Hidden accounts:** left out of the net worth chart and today's net worth unless `includeHidden` is set (`balances/chart.ts`).
- **No-income horizon:** the upcoming view looks 30 days ahead when no income is expected (`NO_INCOME_HORIZON_DAYS`, `recurring/projection.ts`); §9 Open.
- **Upcoming view details:** charges dated today count as not yet posted; only checking, savings and cash accounts get a projection; on the income day, that day's charges fall into the next window (`recurring/projection.ts`).
- **Variable bills:** estimated as the average of the last 3 amounts; a bill is "variable" when its recent amounts vary by more than 5%; charges first seen within 30 days are listed as new (`recurring/merge.ts`).
- **Goal rates:** "recent contribution rate" uses the last 3 months; expected-contribution status shows the current period plus 3 recent ones (`goals/progress.ts`). Projected completion uses the account's recent monthly growth, filled in priority order.
- **Projection defaults:** 7% return, 4% HYSA, 0% cash, 3% inflation, range ±2 percentage points of return applied to investments only (`DEFAULT_ASSUMPTIONS`, `trajectory/assumptions.ts`); §12 Open asks for the range width.
- **Investment performance start:** the account's value on its first holdings day (on or after the connection day) counts as money put in, because earlier transfers aren't known (`investments/investments.ts`).
- **Manual account starting balance:** stored as a transaction `<accountId>__opening` with a confirmed `transfer` override so it is neither spending nor income; core-flows may want to recognise it explicitly (`actions/accounts/accountActions.ts`).
- **Migration numbering:** the trajectory tables are in `apps/api/migrations/0050_trajectory_assumptions.sql`, with journal entry `0050_trajectory_assumptions` and `meta/0050_snapshot.json`. Reconcile the drizzle journal with the backend track's migrations at merge.
