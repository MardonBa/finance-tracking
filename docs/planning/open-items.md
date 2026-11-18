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
