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

## Phase 2: budgets-goals

- **Loss explanations look back two weeks** (`LOSS_LOOKBACK_DAYS` in `windows/goals/GoalsWindow.tsx`). `goals.explainChanges` explains withdrawals between two balances; a goal that lost money because a higher-priority goal was added or reordered is explained only in that action's before → after preview and the reorder toast, not later on the card (that needs a priority history in core).
- **A new goal celebrates the milestones it already covers.** A goal created on an account with unassigned money plays its milestones right away. Decide whether `goals.create` should mark existing milestones as seen.
- **Goal colours use the stable `colorSlot`** (`goalColor(slot)` in `windows/goals/goalColors.ts`), not `goalColorMap(ids)`. Core reuses the lowest free slot, so a colour can be reused after a goal is archived. Overview should import `goalColor` too.
- **Budget part editor uses one target kind per part** (categories, merchants or one tag) though `budgets.createPart` accepts a mix. A tag part only lists existing tags; new tags come from the Transactions window (`transactions.setTags`).
- **Achievement purchase date** shows the transaction's posted date; the purchase picker shows the ledger date (authorized), so they can differ by a day.
- **Pictures in the plain browser** use IndexedDB (per origin), so a different dev port shows placeholders. Pictures are stored as raw bytes with no size cap beyond 15 MB per pick.
- **History grid bands** (≤ −25%, < −5%, ±5%, ≤ +25%, > +25%) are first guesses (`cellBand` in `windows/budgets/HistoryView.tsx`).
## Phase 2: transactions-spending

Defaults chosen while building the Transactions and Spending windows (each marked `TODO(revisit):` in code).

- **"Usual" and the savings rate aren't clickable.** "Usual" is an average of 1–3 months and the savings rate is a ratio, so neither is a sum of transactions. Income, spending, saved and the previous month's values all drill down (`windows/spending/Summary.tsx`).
- **Linking a refund** only offers the suggestions from `flows.refundSuggestions` (same merchant, ≤ purchase, 90 days). Picking any purchase by hand isn't offered yet (`windows/transactions/RowFixes.tsx`).
- **Merchant view period:** opens on the last 12 months, with This month / 3 months / 12 months to switch (`windows/transactions/MerchantView.tsx`).
- **Search paging:** 200 rows, "Show more" up to 1000 (the query's limit) (`windows/transactions/SearchView.tsx`).
- **Needs a look fixes run in one click** (no separate preview step) and then show the before → after with Undo; row fixes elsewhere preview first, then Apply.
- **One note per matched transfer:** `transactions.setNote` now stores the pair's note on the money-out half and clears any note on the other half (core change, tested in `packages/core/test/flows/windowQueries.test.ts`).
- **Category colours** come from the last 12 months of spending by broad category (`src/data/useCategoryColors.ts`); the Spending and Transactions windows install it. Other windows can call the same hook so colours agree.
- **Spending tabs:** Flow (default), Categories, Merchants, Calendar, Saving, Necessary?, Worth a look. Small multiples and saved-by-destination show 6 months; top merchants and the savings rate 12.
- **Heatmap shading** uses 5 steps scaled to the month's biggest day, so one rent day makes other days pale; the amount is printed in every cell.
- **New core queries:** `transactions.filterOptions` (categories and tags for filters and fixes) and `spending.necessityLabels` (what to label, with spend and current label). Rows now carry `tagIds`, `necessity` and `necessitySource`.

## Phase 2: recurring-trajectory-invest

- **New core action `investments.setNote`** (`packages/core/src/actions/investments/setNote.ts`): `transactions.setNote` only reaches `transactions`, so notes on buys/sells/dividends/fees needed their own action. The note lives on the `investment_transactions` row; the backend's investment sync doesn't overwrite `note` (it isn't in the upsert's update list), keep it that way.
- **Dev seed is thin for these windows:** `npm run reset:dev` saves only today's balance snapshots (no rebuilt/estimated history), links no transactions to recurring items (so nothing to drill into, no estimates or price changes), and Acme Corp's income has no `predictedNextDate` (so it never counts as the next income until edited). The windows handle it, and tests cover estimated history, estimates and drill-downs with fixtures, but a richer seed would show more in the running app (Phase 0/backend seed owners).
- **Net worth range:** "By month" shows month-end points over the last 24 months, "By year" year-end points over 10 years (`windows/trajectory/NetWorthTab.tsx`). Daily detail isn't shown; the hover still has every account and the total.
- **Projection defaults:** opens on 30 years in today's dollars. Usual income/spending come from `spending.monthlySummary` (average of the last 3 full months); when there's no history yet the projection uses $0 and says so in the field hints.
- **Assumption edits are a local what-if** (sent to `trajectory.projection` as `assumptions` / `phases`, debounced 250 ms) and stored only on "Save" (previewed). Unsaved edits are lost when the window closes.
- **Card "paid from" when no statement is due:** no query returns a card's `payingAccountId` unless a statement is due, so the picker shows "Not set" then; the action preview shows the real current value. A small `recurring.cards` query would fix it.
- **Earning vs spending by year** drills down through `flows.income` / `spending.byCategory` totals for the calendar year (no year figures in `spending.cashFlow`); year view covers the last 36 months.
- **Overview hook:** `windows/recurring/warnings.tsx` exports `useLowBalanceWarnings()` and `<LowBalanceWarnings onOpen />` (renders nothing when every account is covered).
- **Shared bits:** `windows/shared/` (format helpers, `ReviewAndConfirm`: a Review button that opens the shared `ui/ActionConfirm` card, layout CSS) and `src/test/` (in-process core backend for window tests, chart stub). `src/test/coreBackend.tsx` overlaps main's `windows/testing/`; merge the two later.
