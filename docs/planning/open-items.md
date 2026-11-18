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
## Phase 1: shell

- **Orange and pink shades (follow-up to the Phase 0 item):** settled for now in `apps/desktop/src/ui/tokens.css` and checked by `src/ui/contrast.test.ts`. Text shades `--orange-700 #9a4416` / `--pink-700 #a03158` pass 4.5:1 on every cream; chart shades `--orange-600 #c2601f` / `--pink-600 #c74a78` pass 3:1. The 500/300/100 shades are fills only. Confirm the look in the styleguide (`#styleguide` in a dev build).
- **Keychain access control:** the credential item has no user-presence ACL (that needs a signed app with a keychain-access-groups entitlement). Reads are gated in Rust: `get_credential` refuses unless Touch ID unlocked the session (`src-tauri/src/native.rs`).
- **Google client secret in the binary:** baked in at build time from `.env` for the Desktop OAuth client, which Google treats as non-confidential; PKCE protects the code (`src-tauri/src/oauth.rs`).
- **Sign-in timeout:** the loopback listener waits 5 minutes for the browser (`src-tauri/src/oauth.rs`).
- **Relock granularity:** the 72h check runs every 30 s, so the relock can fire up to 30 s late (`src-tauri/src/relock.rs`).
- **Deep links under `tauri dev`:** macOS only registers `financetracker://` for a bundled app; test deep links with `tauri build` (`src-tauri/src/lib.rs`).
- **Window sizes after the app window shrinks:** windows shrink to fit and stay that size when the app window grows again (`src/shell/wm/state.ts`).
- **Category colours:** 6 named colours, categories under 2% of the total share "Other" (`src/ui/colorMap.ts`).
- **Dev auth bypass:** `VITE_DEV_AUTH_BYPASS=1` must be passed on the command line; `sync-dev-vars` doesn't write it (`src/api/client.ts`).
- **"Add a bank" before Phase 2:** shows a placeholder dialog until the onboarding track registers the `add-banks` step (`src/auth/AuthGate.tsx`).

## Phase 1: core-flows

- **Transfer window:** automatic matching pairs equal amounts within 5 calendar days (`MATCH_WINDOW_DAYS`, `packages/core/src/flows/transfers.ts`). Amount-only matches need one half labelled as a transfer by Plaid (or uncategorised, e.g. cash) and are flagged for review in Needs a look.
- **Refund window:** refunds are suggested against purchases up to 90 days earlier (`REFUND_WINDOW_DAYS`, `flows/refunds.ts`).
- **Unlabelled money in:** an inflow with no income category, rule or override counts as a credit against spending (an unlinked refund or reimbursement), never as income (`flows/ledger.ts`).
- **Undoing a transfer:** if a transaction still looks like a transfer after unmatching (Plaid's label or a rule), it is set to spending unless another bucket is chosen (`flows.unmarkTransfer`).
- **Dividends from investment transactions:** brokerage dividends/interest are read from `investmentTransactions`; if an institution also reports them in `/transactions`, they would count twice (`flows/ledger.ts`).
- **Needs a look thresholds:** last 90 days by default; "large unusual" = more than 3× the category's 180-day average and at least $100 above it, or ≥ $500 with little history unless the same merchant charged a similar amount before; duplicates = same account, amount and merchant on the same day (`flows/needsALook.ts`).
- **Worth a look thresholds:** category pace ≥ 1.25× usual-by-this-day and ≥ $25 above; rising merchant ≥ 1.5× and ≥ $20 above, or three rising months; small frequent = ≥ 5 purchases of ≤ $15 in one detailed category (`spending/worthALook.ts`).
- **Recurring signals:** Worth a look derives "new recurring" (first seen this month) and "price increase" (last > average by 5%) from `recurringItems` until the recurring module exposes its own detection (`queries/spending/spendingQueries.ts`).
- **Rules apply to the past too:** "always for this merchant" rules are evaluated on read, so they also recategorise earlier transactions; there is no "from date" on rules (`transactions.recategorise`).
- **Budget part priority:** trip → tag part → merchant part → category part → Everything else. The criteria fix only tag > category; merchant > category is a choice (`budgets/budget.ts`).
- **Budget history rows:** part versions are grouped by name, so renaming a part starts a new history row; "Everything else" is a remainder row, not a part with its own plan (`budgets/budget.ts`).
- **Plan edits:** changing an amount or a part applies from the start of the current period; finished periods keep their plan.
- **Opening balances:** transactions whose id ends in `__opening` (from `accounts.addManualAccount`) are always transfers, never auto-matched and never "saved", even if an override says otherwise (`flows/ledger.ts`). This replaces relying on the confirmed transfer override alone.
