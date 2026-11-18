# Criteria verification

**Status:** Phase 4 (verify-fix), 2026-11-18. Branch `feat/verify-fix`.
**Related:** [success-criteria.md](./success-criteria.md), [manual-checklist.md](./manual-checklist.md), [open-items.md](./open-items.md)

One row per "Done when" checkbox in §0–§17. Each claimed test was opened and its assertion read, not just its name.

- ✅ **automated**: a test asserts it (or a command shows it, where noted).
- 🧑 **manual**: only you can check it (real Touch ID, browser OAuth, real banks, production, taste); it's on the [manual checklist](./manual-checklist.md). Automated parts are listed too.
- ❌ **gap**: neither.

Paths: `core/` = `packages/core/test/`, `api/` = `apps/api/test/`, `app/` = `apps/desktop/src/`, `rs/` = `apps/desktop/src-tauri/src/`. "M: …" quotes the manual-checklist line.

**Totals (238 checkboxes):** ✅ 226 automated (45 of them, marked ✅ 🧑, also have a manual check of the real thing) · 🧑 12 manual only · ❌ 0.

## 0. The app as a whole

| Criterion | Status | Evidence |
|---|---|---|
| Where it goes: every dollar categorised, traceable to merchants and transactions | ✅ | `core/flows/ledger.test.ts` "every transaction lands in exactly one bucket, and its entries add up to its amount"; `core/flows/provenance.test.ts` "every figure drills down to exactly its number"; `app/windows/spending/spending.test.tsx` "every clickable figure, bar, segment and cell drills to a list whose total equals it" |
| Where it comes from: income by source incl. interest, dividends; own transfers excluded | ✅ | `core/flows/ledger.test.ts` "paychecks, HYSA interest and brokerage dividends are income", "refunds, reimbursements and transfers in from my own accounts are not income"; `api/node/sandbox-ledger.test.ts` "interest and paychecks are income" |
| Goals: set goals, see funding and when reached | ✅ | `core/balances-track/goals.test.ts` "needed per month and behind amount", "fills goals in order at the recent rate…"; `app/windows/goals/GoalsWindow.test.tsx` "shows each goal with its progress ring, deadline need, contribution status and projection" |
| Insights: ask, answers from real data, AI only when asked | ✅ | `api/workers/ai.test.ts` "runs a read tool from the query registry and returns the answer with cited figures", "queries, actions, the action log and the daily cron never call Gemini"; `app/windows/assistant/assistant.test.tsx` "says it only runs when asked and sends nothing until then"; live run: `docs/planning/ai-live-check.md` |

## 1. Project foundation

| Criterion | Status | Evidence |
|---|---|---|
| Frontend hot reload; backend reloads without restart | ✅ | Checked by the orchestrator 2026-11-18 on this Mac: during `npm run dev`, a frontend edit logged `[vite] hmr update` (Fast Refresh, after un-exporting a helper from `shell/Window.tsx` that forced invalidation) and a backend edit logged `⎔ Reloading local server… updated and ready`. Vite HMR seen in the Phase 4 smoke (`[vite] hot updated: …` after each edit); `wrangler dev` reloads on save. M: "`npm run dev`: edit a window's text and a route; both update without restarting" |
| App and backend run locally with one command | ✅ | Checked by the orchestrator 2026-11-18: one `npm run dev` brought up wrangler (`/health` ok on :8787), Vite (:1420) and the Tauri app process. Root `npm run dev` (concurrently: `dev:api` + `dev:app`). M: "`npm run dev` with an empty Keychain…" |
| Shipping is a short documented routine | ✅ | `docs/shipping.md` (three `ship:*` commands); `api/node/shipping.test.ts` "there are ship scripts for the dev and production Worker and the app", "deploys apply migrations first and always name the environment" |
| Whole cents; Plaid decimals converted once and tested | ✅ | `core/money.test.ts` "toCents › converts the number %s to %s cents", "rejects invalid input"; `api/node/plaid-fixtures.test.ts` "a full Sandbox-shaped sync response keeps only the stored transaction fields" (amountCents from 12.34) |
| Money calculations are pure functions | ✅ | `core/purity.test.ts` "no source file reads the clock, the network or randomness", "the checker catches every banned pattern" |
| One implementation shared by UI, API, AI | ✅ | `api/workers/registry.test.ts` "serves a query over POST and GET with the same result the core function gives"; `api/node/ai-tools.test.ts` "maps every read tool to an existing registry query, and every query has one"; desktop window tests render real registry output (`app/test/coreBackend.tsx`) |
| Unit tests: normal, edge (zero, month boundaries, leap days, time zones), tricky cases | ✅ | `core/flows/ledger.test.ts` "month boundary: bought Oct 31, posted Nov 2…", "leap day counts in February", time-zone case; `core/dates.test.ts` "knows leap years"; `core/flows/rules.test.ts` "tricky case: a coincidental match is flagged for review and can be undone", "tricky case: a refund in a later month counts in the purchase's period" |
| Invariants: splits, goal caps, transfers net zero, category totals | ✅ | `core/flows/ledger.test.ts` "matched transfers net to zero", "category totals add up to total spending, every month", "splits add up to the original amount"; `core/balances-track/goals.test.ts` "invariant: allocations never exceed the balance (property)" |
| Any number traceable to its transactions | ✅ | `core/flows/provenance.test.ts` "<query>: every figure drills down to exactly its number" (every registered query, both fixtures); `app/windows/spending/spending.test.tsx`, `app/windows/budgets/BudgetsWindow.test.tsx` "every bar figure drills down…"; smoke: Overview, Spending, Budgets, Trajectory and Balance check drills matched to the cent |
| Tests run with one command and must pass before shipping | ✅ | `npm test` (all workspaces + `cargo test`); `api/node/shipping.test.ts` "ship:check is typecheck + npm test", "%s runs ship:check before anything else", "docs/shipping.md routes every release through the ship scripts" |
| Separate dev/prod environments; dev can't reach prod data or secrets | 🧑 | `apps/api/wrangler.toml` `[env.dev]` / `[env.production]` with separate D1, R2, vars; `api/workers/auth.test.ts` "is rejected in production, even if the secret were set there" (dev token); `api/workers/connections.test.ts` "does not exist in production, even with a valid credential" (sandbox routes). M: "Set production secrets with `npx wrangler secret put …`" |
| Format matches real data: SDK types, runtime schema checks in both envs, real prod fixtures | 🧑 | Types: `apps/api/src/plaid/schemas.ts` `satisfies Accepts<…, Plaid.X>` (checked by `npm run typecheck`); `api/node/plaid-allowlist.test.ts` "fails loudly when a response does not match its schema"; `api/node/plaid-fixtures.test.ts` picks up every file in `test/fixtures/plaid/production/` automatically; `api/node/anonymise.test.ts` (the anonymiser keeps every Sandbox response schema-valid). The real files: M: "Connect a real bank, then save 2–3 anonymised production Plaid responses…" |
| Sandbox data covers transfers, card payments, refunds, interest, paychecks, pending→posted, holdings | ✅ | `api/node/plaid-fixtures.test.ts` "the saved Sandbox data covers what the money math must handle (§1) › %s" (7 cases); pending→posted: `api/workers/sync.test.ts` "reuses the pending row for the posted transaction…" (Sandbox can't post a pending charge, open-items Phase 0) |
| Dev environment resets with one command | ✅ | `npm run reset:dev` (run in the Phase 4 smoke: drops, migrates, seeds 205 transactions, runs snapshot upkeep) |

## 2. Backend & app login

| Criterion | Status | Evidence |
|---|---|---|
| Identity is my Google account; others refused, nothing created | ✅ 🧑 | `api/workers/auth.test.ts` "refuses any other Google account with 403 and creates nothing", "issues a working, hashed, expiring app credential for the allowed account". M: "Sign in with a different Google account → refused, nothing created." |
| Opening requires Touch ID (password fallback); no data before | 🧑 | `app/auth/gate.test.ts` "returning: Touch ID first, nothing before success" (mocked native); `rs/native.rs` LAContext. M: "Touch ID prompt: cancel once…", "Quit and relaunch → Touch ID is asked before anything shows; try the Mac-password fallback too." |
| Locks after 72 hours | ✅ 🧑 | `rs/relock.rs` `default_period_is_72_hours`, `unlocked_until_exactly_72_hours`, `expire_if_due_fires_once`; `app/auth/gate.test.ts` "72h relock returns to the lock screen". M: "Relock: set `RELOCK_AFTER_SECS`…" |
| Credential in Keychain, readable only after Touch ID; revoked/expired → Google again | 🧑 | Gate in `rs/lib.rs` `get_credential` (refuses unless unlocked; no Rust test, needs the real Keychain). Sign-in-again half: `app/auth/gate.test.ts` "an API 401 goes back to Google sign-in", "a missing credential after Touch ID goes back to Google sign-in". M: "Quit and relaunch…", "Revoke: `POST /auth/revoke`…". Note: no user-presence ACL on the item (open-items, shell). |
| Every request without a valid credential rejected, no data, every endpoint | ✅ | `api/workers/auth.test.ts` "rejects {no credential, a malformed header, an unknown token, a revoked token, an expired token} with an empty 401 on every non-exempt route" (routes read from `app.routes`) |
| I can revoke; revoked stops at once | ✅ 🧑 | `api/workers/auth.test.ts` "revokes the current credential immediately, or all of them". M: "Dock → Security: … 'Sign out this Mac'…" |
| Plaid webhooks verified before acting | ✅ 🧑 | `api/workers/webhook.test.ts` "rejects unverified webhooks with an empty 401 and does nothing", "acts on a correctly signed webhook". Live: verified against the deployed dev Worker (orchestrator). M: "Webhooks from Plaid…" |
| Read-only Plaid products only | ✅ | `api/node/plaid-allowlist.test.ts` "only allows read-only Link products"; `api/workers/connections.test.ts` "requests only read-only products, 24 months of history, and Hosted Link back to our redirect page" |
| Plaid client can only call allowlisted endpoints; test fails on additions | ✅ | `api/node/plaid-allowlist.test.ts` "matches its snapshot exactly", "has a response schema for every allowed endpoint and nothing else", "refuses any endpoint outside the allowlist, even when forced past the types", "contains no Auth, Identity, Transfer, Payment Initiation… endpoints" |
| No feature in UI, API or AI initiates a payment or transfer | ✅ | API: `api/workers/auth.test.ts` "no route moves money (§2)…"; UI mutations only go through registry actions, and `api/node/ai-tools.test.ts` "no action moves money (there should be none)"; AI: "excludes bank connections, sign-in/security and money movement, each with a reason"; Plaid: allowlist row above |
| Schema stores only needed fields, each with a reason | ✅ | `api/node/schema.test.ts` "every column has a comment giving the reason it is stored", "the comment check sees every column drizzle knows about" |
| Never stored: account/routing numbers, owner identity, location | ✅ | `api/node/schema.test.ts` "never stores account/routing numbers, owner identity or location"; `api/node/plaid-fixtures.test.ts` "a full Sandbox-shaped sync response keeps only the stored transaction fields" |
| Raw bank description stored | ✅ | `api/node/plaid-fixtures.test.ts` same test (`rawDescription` = "SECRET CAFE #42 HOMETOWN CA") |
| Trimmed before saving; full response in, nothing extra stored | ✅ | `api/node/plaid-fixtures.test.ts` "keeps only the stored transaction fields", "every saved sandbox/production response trims to allowed fields only"; `api/workers/sync.test.ts` "imports every page, stores trimmed rows in our sign convention, and saves the cursor" |
| Access tokens encrypted with a key in a Workers secret | ✅ 🧑 | `api/workers/connections.test.ts` "collects the result from Plaid, encrypts the token, saves trimmed accounts…" (no plaintext, decrypts back). Production key: M: "Set production secrets… `TOKEN_ENC_KEY`…" |
| AI data tools = the chart queries; no AI-only or bulk export | ✅ | `api/node/ai-tools.test.ts` "maps every read tool to an existing registry query, and every query has one", "has only query tools and action-proposal tools: no raw table, SQL, bulk or export tool", "cuts long arrays and caps the size (no bulk dumps)" |
| A test checks every AI read tool maps to a visualization query | ✅ | `api/node/ai-tools.test.ts` "maps every read tool to an existing registry query, and every query has one" |
| Data that can't be re-fetched is backed up | ✅ | `api/workers/backup.test.ts` "backup → fresh database → restore gives identical rows" (every table in `BACKUP_TABLES`) |
| Scheduled job exports encrypted to R2 weekly | ✅ | `api/workers/backup.test.ts` "the weekly cron writes a backup for the user's date" (file starts `FTB1`, no plaintext); cron `0 12 * * SUN` in `wrangler.toml` |
| Restore into a fresh database tested and documented | ✅ 🧑 | `api/workers/backup.test.ts` round trip; `docs/backup-restore.md`. M: "Restore one backup into a fresh remote database" |

## 3. Connecting accounts

| Criterion | Status | Evidence |
|---|---|---|
| Step 1: Google in the system browser, PKCE, returns to app | ✅ 🧑 | `rs/oauth.rs` `authorization_url_carries_pkce_and_loopback_redirect`; `api/workers/auth.test.ts` (allowlist). M: "`npm run dev` with an empty Keychain → 'Sign in with Google'…" |
| Step 2: set up Touch ID, then Touch ID instead of Google | ✅ 🧑 | `app/auth/gate.test.ts` "first run: Google sign-in, then one Touch ID, then the desktop". M: Touch ID lines |
| Step 3: prompted to add banks; opens Plaid Link | ✅ 🧑 | `app/auth/gate.test.ts` "first run runs the Phase 2 onboarding steps (add banks) before the desktop"; `app/connections/useConnectFlow.test.tsx` "opens Hosted Link in the system browser, then finalizes when the deep link arrives". M: "First run in the real app…" |
| OAuth banks (Chase) work and land back in the app | 🧑 | Backend path shared with every bank (rows below). M: "Platypus OAuth Bank: same, through the bank's OAuth page", "Real Chase: finish Chase's OAuth registration in the Plaid dashboard" |
| Hosted Link in the system browser, `financetracker://` return, backend collects the result | ✅ 🧑 | `api/workers/connections.test.ts` "requests only read-only products…Hosted Link back to our redirect page"; `api/workers/webhook.test.ts` "SESSION_FINISHED collects the Link result and saves the bank (no app needed)"; `app/connections/machine.test.ts` "reads the session from financetracker://plaid-complete links only". M: "Connect a bank (Sandbox First Platypus…)" |
| Redirect page hands off to `financetracker://` | ✅ | `api/workers/connections.test.ts` "hands off to financetracker:// with our session id and needs no credential", "never echoes anything that is not one of our session ids" |
| Proven with a Sandbox spike first | 🧑 | `docs/planning/plaid-hosted-link-spike.md`, `apps/api/scripts/plaid-spike.ts`. M: "Hosted Link in a browser (Sandbox)…" |
| Maximum history (24 months) requested | ✅ | `api/workers/connections.test.ts` "requests only read-only products, 24 months of history…" (`days_requested` 730) |
| After each bank: accounts found, add another or finish | ✅ 🧑 | `app/connections/machine.test.ts` "pending results keep waiting; another bank can be added after; banks accumulate". M: "…the accounts found are listed" |
| Finish with zero banks; app opens normally | ✅ 🧑 | `app/windows/windows.test.tsx` "%s window with no data at all › loads, says what goes there and offers a next step" (every window with no accounts). M: "Check 'Skip for now' lands on the desktop with no banks." |
| Rename, hide, fix type of each account | ✅ | `app/accounts/manual.test.tsx` "renames, retypes and hides an account through confirmed actions"; `api/workers/sync.test.ts` "refreshes balances and never overwrites my nickname, hidden flag or type fix" |
| Each bank shows "Importing transactions…" → "Up to date" | ✅ | `api/workers/sync.test.ts` "shows a bank as importing until Plaid's history download completes"; `app/windows/overview/overview.test.tsx` "'Add account' offers a bank… accounts show importing, then updated…" |
| "Add account" on the Overview opens the same bank flow | ✅ | `app/windows/overview/overview.test.tsx` "'Add account' offers a bank (the same Plaid flow) or a manual account…" (calls the shell's `addBanks`) |
| Manual account (e.g. Cash) with starting balance | ✅ | `app/accounts/manual.test.tsx` "adds a manual account with a starting balance (confirmed first)" |
| Add/edit/delete manual transactions; balance follows | ✅ | `app/accounts/manual.test.tsx` "adds, edits and deletes a transaction with category and note; the balance follows"; `core/onboarding-overview/manual-transactions.test.ts` |
| Manual accounts in net worth and snapshots, labelled manual | ✅ | `core/balances-track/snapshots.test.ts` "marks manual accounts' snapshots as manual"; `api/workers/snapshot-maintenance.test.ts` "keeps a manual account's balance and snapshots equal to its transactions"; `app/windows/overview/overview.test.tsx` (Cash shows "Manual" and "Entered by hand") |
| Cancel/fail leaves nothing half-saved; retry at once | ✅ | `api/workers/connections.test.ts` "cancelling in Link leaves nothing saved, and a new attempt works straight away", "a failure partway (%s) leaves nothing half-saved"; `app/connections/machine.test.ts` cancel case |
| Already-connected bank detected and warned | ✅ | `api/workers/connections.test.ts` "warns about a bank that is already connected and never counts it twice", "detects a duplicate by matching account mask and name…" |
| Trial limit (10) warned before starting | ✅ | `api/workers/connections.test.ts` "reports the Trial limit and refuses a new bank once 10 are connected"; `app/connections/machine.test.ts` Trial limit case |

## 4. Sync & connection health

| Criterion | Status | Evidence |
|---|---|---|
| Daily job syncs every bank, laptop on or off | ✅ | `api/workers/sync.test.ts` "syncs every bank, one failure doesn't stop the others, and saves today's snapshot per account"; `api/workers/scheduled.test.ts` (exported handler); cron in `wrangler.toml` |
| Webhooks handled for sooner data | ✅ | `api/workers/webhook.test.ts` "acts on a correctly signed webhook (SYNC_UPDATES_AVAILABLE syncs the item)" |
| Safe to repeat; no duplicates | ✅ | `api/workers/sync.test.ts` "is safe to repeat: a second sync and a replayed page create no duplicates", "locks per item: an overlapping run does nothing" |
| Pending replaced by posted; edits carry over | ✅ | `api/workers/sync.test.ts` "reuses the pending row for the posted transaction (removal and addition in the same page)", "also works when the removal arrives a sync before the posted version" |
| Removed transactions removed; dependents flagged | ✅ | `api/workers/sync.test.ts` "marks removed transactions and flags what depends on them for review, deleting nothing" |
| Refresh: asks Plaid, progress, "Up to date" or the error | ✅ 🧑 | `api/workers/sync.test.ts` "asks Plaid to refresh each bank, fetches live balances, syncs, and reports per bank", "calls investments refresh only for items with Investments". M: "Refresh on the Overview: progress, then 'Up to date' or the bank's error with Reconnect." |
| Each account shows when last updated | ✅ | `api/workers/sync.test.ts` "records ITEM_LOGIN_REQUIRED… with a message and last-updated time", "falls back to our own last sync time…"; `app/windows/overview/overview.test.tsx` "each card shows what §13 asks for…" (every account row says "Updated …" or why not) |
| Broken bank prompts right after Touch ID, naming bank and problem | ✅ 🧑 | `app/auth/Ready.test.tsx` "the gate reaches ready only after Touch ID, and Ready then prompts for the broken bank, naming it and the problem". M: "`/sandbox/item/reset_login`… quit and relaunch…" |
| Reconnect uses update mode, keeps history | ✅ 🧑 | `api/workers/connections.test.ts` "starts update mode for a reconnect with the item's token and no products", "update mode marks the bank fixed and resyncs, with no new item"; `app/connections/machine.test.ts` update-mode case. M: same line |
| Dismissed prompt: accounts marked out of date, totals say so | ✅ | `app/auth/Ready.test.tsx` "expiring consent and errors prompt too; 'Not now' dismisses"; `app/windows/overview/overview.test.tsx` "a bank needing reconnection appears in the strip and marks its accounts out of date, with the totals saying so" |
| About-to-expire consent prompts before it ends | ✅ | `api/workers/webhook.test.ts` "PENDING_EXPIRATION and PENDING_DISCONNECT warn before access ends"; `app/auth/Ready.test.tsx` (expiring consent prompts) |
| One bank's failed sync doesn't stop others | ✅ | `api/workers/sync.test.ts` "syncs every bank, one failure doesn't stop the others…" |

## 5. Daily snapshots

| Criterion | Status | Evidence |
|---|---|---|
| Daily snapshot of every account; debts negative | ✅ | `core/balances-track/snapshots.test.ts` "saves one snapshot per account; credit cards and loans are negative contributions"; `api/node/plaid-fixtures.test.ts` "debts are stored as negative net-worth contributions" |
| Investments at total value | ✅ | `core/balances-track/snapshots.test.ts` "snapshots investment accounts at the total value of their holdings" |
| Net worth = sum of that day's snapshots | ✅ | `core/balances-track/snapshots.test.ts` "matches the sum for random data (property)" |
| Older than 90 days → weekly | ✅ | `core/balances-track/snapshots.test.ts` "keeps the last 90 days daily and one per week (end of week) before that"; `api/workers/snapshot-maintenance.test.ts` "downsamples snapshots older than 90 days to one per week" |
| Missed day: gap or flagged carry, never zero | ✅ | `core/balances-track/snapshots.test.ts` gap/carry cases; `api/workers/sync.test.ts` "marks a balance that wasn't refreshed as carried forward, never fresh" |
| Checking/savings/credit rebuilt backwards | ✅ | `core/balances-track/snapshots.test.ts` "marks rebuilt snapshots as estimated and covers every day back to the first transaction"; `api/workers/snapshot-maintenance.test.ts` "rebuilds estimated history only once the bank's history import is complete" |
| Rebuilt history marked estimated | ✅ | `core/balances-track/snapshots.test.ts` "real snapshots win over rebuilt ones when merged"; `app/windows/trajectory/trajectory.test.tsx` "marks estimated history, says where each account's history starts…" |
| Replay test lands on today's balance to the cent | ✅ | `core/balances-track/snapshots.test.ts` "replaying the rebuilt history forward lands exactly on today's balance, to the cent" |
| Unrebuildable accounts start at connection, chart says so | ✅ | `core/balances-track/snapshots.test.ts` "investments and accounts with missing transactions start at their connection date, with a reason"; trajectory window test above |
| Net worth chart stacked by account, debts below | ✅ 🧑 | `app/windows/trajectory/trajectory.test.tsx` (assets/debts stacks); `core/balances-track/snapshots.test.ts` "stacks by account with debts below zero…". M: "Trajectory: hover the net worth chart…" |
| Hover: date, each account, total | ✅ | `app/windows/trajectory/trajectory.test.tsx` "…shows date + each account + total on hover" |
| All accounts vs grouped by type | ✅ | `app/windows/trajectory/trajectory.test.tsx` "switches between all accounts and grouped by type"; `core/balances-track/snapshots.test.ts` "groups by type…" |

## 6. Transaction rules

| Criterion | Status | Evidence |
|---|---|---|
| Card purchase counts once; paying the card is a transfer | ✅ | `core/flows/ledger.test.ts` "a card purchase counts once; paying the card is a transfer (both halves matched)"; `api/node/sandbox-ledger.test.ts` "paying the credit card from checking is a transfer on both sides" |
| Into savings/investments is a transfer; buys/sells neither | ✅ | `core/flows/ledger.test.ts` "checking → HYSA and checking → brokerage are transfers; buys inside the brokerage are neither"; `api/node/sandbox-ledger.test.ts` "checking → savings is a transfer on both sides" |
| Halves matched automatically (amount, ~5 days, Plaid labels first) | ✅ | `core/flows/rules.test.ts` "matches an equal outflow and inflow across accounts within ~5 days, Plaid's transfer labels first", "does not match beyond the window…", "prefers the labelled pair over an amount-only coincidence" |
| One "Transfer: A → B" item; can be undone | ✅ | `core/flows/rules.test.ts` "manual pairing checks direction and amount, and shows one 'Transfer: A → B' item", "tricky case: a coincidental match is flagged for review and can be undone"; `app/windows/transactions/transactions.test.tsx` "marks a purchase as Transfer from its row…" |
| Interest and dividends are income | ✅ | `core/flows/ledger.test.ts` "paychecks, HYSA interest and brokerage dividends are income"; `api/node/sandbox-ledger.test.ts` "interest and paychecks are income" (checking interest) |
| Refunds, reimbursements, own transfers-in not income | ✅ | `core/flows/ledger.test.ts` "refunds, reimbursements and transfers in from my own accounts are not income"; `api/node/sandbox-ledger.test.ts` "a refund is not income" |
| Per account: start + in − out = end; "unexplained" shown on that account | ✅ | `core/flows/rules.test.ts` "per account: start + in − out = end; a difference is shown as unexplained"; `app/windows/transactions/transactions.test.tsx` "openItem 'reconciliation' before mount opens the balance check: unexplained shown on the account…", "the account sheet shows this month's unexplained difference on that account…" |
| Across everything: net worth equation, leftover shown | ✅ | `core/flows/rules.test.ts` "across everything: income − spending ± transfers ± investment change = change in net worth, leftover shown"; `app/windows/transactions/transactions.test.tsx` (Balance check shows the leftover) |
| Every transaction in exactly one bucket (test over test data) | ✅ | `core/flows/ledger.test.ts` "every transaction lands in exactly one bucket…" (both fixtures); `api/node/sandbox-ledger.test.ts` "every Sandbox transaction lands in exactly one bucket" |
| Splits add up; linked refund can't go below zero | ✅ | `core/flows/rules.test.ts` "the split action refuses parts that don't add up…", "a linked refund can't reduce the purchase below zero" |
| Each case tested with Sandbox and hand-built data | ✅ | Hand-built: `packages/core/fixtures/flows.ts` + `core/flows/*`; Sandbox: `api/node/sandbox-ledger.test.ts` |
| Merchant + category + amount everywhere a transaction appears | ✅ | `app/windows/transactions/transactions.test.tsx` "searches notes and amounts; rows show merchant, category, amount, account and markers"; `app/windows/overview/overview.test.tsx` "each card shows what §13 asks for…" (recent rows); Needs a look rows use the same `TxRow` |
| "Needs a look" holds only what the app is unsure about | ✅ | `core/flows/rules.test.ts` "holds only what the app is unsure about", "large unusual compares with the category's history", "a repeated big charge (rent) is not unusual"; `app/windows/transactions/transactions.test.tsx` "Needs a look: one click fixes an item…" |
| Fixing a category is one action with "always for this merchant" | ✅ | `app/windows/transactions/transactions.test.tsx` "recategorises with 'always do this for this merchant'" |
| Rules order: my fix → my rules → Plaid | ✅ | `core/flows/ledger.test.ts` "rule order: my fix → my rules → Plaid (§6, decision 005)" (four cases) |
| Unmatched Plaid transfer counts as transfer, in Needs a look until confirmed | ✅ | `core/flows/rules.test.ts` "an unmatched Plaid-labelled transfer counts as a transfer and sits in Needs a look until confirmed or covered by a rule" |
| Mark Poker, with a payer/payee rule | ✅ | `core/flows/rules.test.ts` "mark Poker with a rule, and unmark it"; `app/windows/transactions/transactions.test.tsx` "marks a purchase as Poker from its row…" |
| Poker kept out of spending and income | ✅ | `core/flows/rules.test.ts` "Poker rules by payer/payee keep individual Poker money out of spending and income" |
| Net Poker counts as one income line (can be negative) | ✅ | `core/flows/rules.test.ts` "the Poker summary shows in, out and net; the net is one income line and can be negative" |
| Poker summary: in, out, net for any period | ✅ | Same core test; `app/windows/transactions/transactions.test.tsx` "the Poker summary shows money in, out and the net for the month, each drilling down" |
| Cash: manual account, same rules; ATM is a transfer | ✅ | `core/flows/ledger.test.ts` "an ATM withdrawal into the cash account is a transfer", "cash transactions follow the same rules"; `app/accounts/manual.test.tsx` |

## 7. Transactions view

| Criterion | Status | Evidence |
|---|---|---|
| Any chart number opens the list filtered to it, filter shown | ✅ 🧑 | `app/windows/transactions/transactions.test.tsx` "on mount, shows exactly the figure's transactions under the filter header…"; `app/windows/spending/spending.test.tsx` "every clickable figure, bar, segment and cell drills…"; budgets/trajectory/recurring/overview/investments drill tests; smoke run. M: "With real data: click a few Sankey flows…" |
| List total equals the number clicked; a test for every chart | ✅ | `core/flows/provenance.test.ts` "<query>: every figure drills down to exactly its number" (every registered query); `app/windows/spending/spending.test.tsx` "every Sankey link and node maps to a figure whose drill-down total equals it" |
| Split parts and linked refunds with their parent | ✅ | `core/flows/provenance.test.ts` "split parts and linked refunds appear with their parent purchase"; `app/windows/transactions/transactions.test.tsx` "shows a split part with its parent purchase and what it counted" |
| Merchant view: transactions, total, count, 6–12 month trend | ✅ | `app/windows/transactions/transactions.test.tsx` "shows all its transactions, the period total, count and a 12-month trend that drills down"; `core/flows/spending.test.ts` "the merchant view…" |
| Merchant grouping sensible; merge/separate | ✅ 🧑 | `core/flows/spending.test.ts` 'normalises "AMAZON MKTP US*2K4" and "Amazon.com" to one merchant', "merge and separate". M: "Check that merchant grouping looks sensible on your real merchants; try one merge and one separate, then Undo." |
| Search by merchant, description, amount, note; date/account/category filters | ✅ | `core/flows/provenance.test.ts` "by merchant, description, amount or note", "filters for date range, account and category; pending only when asked"; `app/windows/transactions/transactions.test.tsx` "searches notes and amounts…", "filters by account and category…" |
| Add, edit, remove a note on any kind of transaction | ✅ | `app/windows/transactions/transactions.test.tsx` "adds a note with a before → after preview…" (and Undo); `core/flows/actions.test.ts` `transactions.setNote` cases; `core/flows/windowQueries.test.ts` "transactions.setNote on a matched transfer keeps one note for the pair"; `core/balances-track/investmentNote.test.ts`; `app/accounts/manual.test.tsx` (cash) |
| Notes shown in the list and searchable | ✅ | `app/windows/transactions/transactions.test.tsx` "searches notes and amounts…" |
| Row: date, merchant, category, amount, account, markers | ✅ | `app/windows/transactions/transactions.test.tsx` "searches notes and amounts; rows show…"; `core/flows/provenance.test.ts` "rows carry markers for pending, transfer, split, refund, Poker and note…"; row aria-label carries the date (`app/windows/windows.test.tsx` names every row toggle) |
| Fixes from the row: recategorise, split, transfer, refund, Poker | ✅ | `app/windows/transactions/transactions.test.tsx` "recategorises…", "split: Preview stays disabled until the parts add up", "marks a purchase as %s from its row…" (Poker, Transfer), "links a refund to any purchase found by search, not only a suggested one" |
| The assistant can read notes (§16) | ✅ | `api/workers/ai.test.ts` "notes are readable through the transaction queries" |

## 8. Spending views

| Criterion | Status | Evidence |
|---|---|---|
| Monthly summary vs previous month and usual | ✅ | `core/flows/spending.test.ts` "income, spending, saved and savings rate, vs previous month and usual (default 3 months)"; `app/windows/spending/spending.test.tsx` "shows the monthly summary with comparisons and says which months usual uses" |
| Flow diagram income → categories → merchants → Saved/Overspent | ✅ | `core/flows/spending.test.ts` "income sources → categories → top merchants, leftover to Saved or Overspent, and it balances"; `app/windows/spending/spending.test.tsx` Sankey test |
| Per-category monthly charts, shared scale, vs usual | ✅ 🧑 | `core/flows/spending.test.ts` "per-category monthly series share a scale and compare with usual". M: "Glance at the Spending window at its default size…" |
| Top merchants with trends; day heatmap | ✅ | `core/flows/spending.test.ts` "top merchants with count and a 6–12 month trend", "the heatmap: a day grid…" |
| Every figure drills down | ✅ | `app/windows/spending/spending.test.tsx` "every clickable figure, bar, segment and cell drills to a list whose total equals it" |
| Saved by destination each month | ✅ | `core/flows/spending.test.ts` "saved by destination: money moved into HYSA and brokerage each month, interest and buys excluded" |
| Savings rate month over month | ✅ | `core/flows/spending.test.ts` "cash flow: savings rate month over month" |
| Necessary / not necessary labels, per-transaction override, no defaults | ✅ | `core/flows/spending.test.ts` "no defaults: unlabelled spending is 'not set'", "transaction beats merchant beats category…", "label actions change the result…"; `app/windows/spending/spending.test.tsx` "labelling a category runs the action and every query refetches" |
| Split/filter by necessity; not-necessary trend; never guessed | ✅ 🧑 | `core/flows/spending.test.ts` "split totals add up and the not-necessary trend is per month". M: "Label your main categories and merchants… 'not set' amount shrinks." |
| "Worth a look" with numbers (pace, rising merchants, small frequent, recurring) | ✅ | `core/flows/spending.test.ts` "lists categories above usual pace, rising merchants, small frequent purchases and recurring signals, with numbers", "the query derives new recurring charges…" |
| Cutting-back list tracked month by month | ✅ | `core/flows/spending.test.ts` "cutting back is tracked month by month against the average before it started"; AI live check added/undid one |
| "Usual" = previous 1–3 months, chosen, stated | ✅ | `core/flows/spending.test.ts` usual basis tests; `app/windows/spending/spending.test.tsx` ("1 month chosen") |

## 9. Recurring charges

| Criterion | Status | Evidence |
|---|---|---|
| Upcoming view per paying account: balance, charges before next income, lowest point | ✅ 🧑 | `core/balances-track/recurring.test.ts` "lists every charge before the next income, including the card statement, and the lowest point"; `app/windows/recurring/recurring.test.tsx` "shows the upcoming view per paying account…". M: "Recurring: with a real bank connected…" |
| Card statements and due dates from the paying account | ✅ | `api/workers/sync.test.ts` "syncs holdings, investment activity, credit statements and recurring streams…"; `core/balances-track/recurring.test.ts`; `core/balances-track/recurring.test.ts` "recurring.cards lists every card with its paying account, even with no statement due"; `app/windows/recurring/recurring.test.tsx` "shows the account a card is paid from even when no statement is due (recurring.cards)" |
| Below-zero warning at top of Overview and recurring view | ✅ 🧑 | `app/windows/recurring/recurring.test.tsx` "warns at the top when the projection goes below zero…", "exports the same warnings for the Overview (hook + banner)"; `app/windows/overview/overview.test.tsx` computeAlerts. M: "Recurring: add a large test charge…" |
| Each projection shows its basis | ✅ | `core/balances-track/recurring.test.ts` (basis lines); `app/windows/recurring/recurring.test.tsx` ("Starts from today's balance of $3,523.10.") |
| List of recurring charges and income | ✅ | `app/windows/recurring/recurring.test.tsx` "lists charges and income with how often, next date and account…"; `core/balances-track/recurring.test.ts` "includes items I added, lists new charges quietly, and drops stopped streams" |
| Month calendar with fixed-cost total | ✅ | `core/balances-track/recurring.test.ts` "shows when each charge hits and the month's fixed-cost total"; `app/windows/recurring/recurring.test.tsx` calendar test |
| Variable bills estimated, marked | ✅ | `core/balances-track/recurring.test.ts` "estimates variable bills from recent amounts and marks them"; recurring window list test ("Estimate") |
| Add, edit, remove an item; projections update | ✅ | `app/windows/recurring/recurring.test.tsx` "adds a recurring charge after a preview, and the projection updates", "edits an item's amount after a preview, and the projection uses the new amount", "removes an item through recurring.remove with a preview" |
| Price changes noted quietly; new charges listed quietly | ✅ 🧑 | `core/balances-track/recurring.test.ts` "a small fixed-price change is a price change, not an estimate"; recurring list test ("New: Streamly."). M: "…a subscription whose price changed shows 'Was $X, now $Y' quietly." |

## 10. Budgets

| Criterion | Status | Evidence |
|---|---|---|
| Overall budget per period (monthly default; weekly/yearly/custom) | ✅ | `core/flows/budgets.test.ts` "monthly by default = calendar months…", "weekly, biweekly, yearly and custom"; `app/windows/budgets/BudgetsWindow.test.tsx` "creates a budget from the empty state, monthly by default" |
| Parts by categories, merchants or a tag | ✅ | `core/flows/budgets.test.ts` "parts: Eating out (Nopa + coffee...), Groceries..., Amazon by merchant", tag-part case |
| "Everything else"; warns when parts exceed overall | ✅ | `core/flows/budgets.test.ts` "Everything else = overall − parts…", "warns when the parts add up to more than the overall"; budgets window warning test |
| At most one part per transaction; trip > part, tag > category | ✅ | `core/flows/budgets.test.ts` "each transaction counts toward at most one part; a trip beats a part, a tag beats a category" |
| New period starts fresh; parts carry over | ✅ | `core/flows/budgets.test.ts` (no carryover), "the plan carries forward; editing it applies from the current period…" |
| Trips with own dates across months, one total, own bar and pace | ✅ | `core/flows/budgets.test.ts` "a trip has its own bar and pace across its dates, spanning months"; budgets window trip test |
| Trip spending is a "Trip: $X this month" line in the overall | ✅ | `core/flows/budgets.test.ts` "trip spending is a 'Trip: $X this month' line in the overall, not in parts"; budgets window test |
| Bars with pace marker and projection | ✅ | `core/flows/budgets.test.ts` "pace marker and end-of-period projection…"; `app/windows/budgets/BudgetsWindow.test.tsx` "shows the overall bar, a bar per part and Everything else, with status as text" |
| Pending as faded extension, not counted | ✅ | `core/flows/budgets.test.ts` same test; `app/windows/budgets/BudgetsWindow.test.tsx` "pending shows as a faded extension that drills to the pending figure" |
| Each bar drills down | ✅ 🧑 | `app/windows/budgets/BudgetsWindow.test.tsx` "every bar figure drills down to a figure the query returns, with the same total"; smoke (Budgets → $2,291.50). M: "Click a budget bar…" |
| Planned vs actual at period end, $ and % | ✅ | `core/flows/budgets.test.ts` "one row per part (by name), overall and Everything else…" (diffCents, diffRatio); `app/windows/budgets/BudgetsWindow.test.tsx` "planned vs actual, the history grid and the track record drill down per cell" |
| History grid coloured by over/under | ✅ | Same tests (cell values and bands; band thresholds in open-items) |
| Track record per part and overall | ✅ | `core/flows/budgets.test.ts` "track record counts finished periods only: within plan and average difference" |

## 11. Savings goals

| Criterion | Status | Evidence |
|---|---|---|
| Goal: name, target, account, priority, picture, deadline, contribution | ✅ | `core/balances-track/registry.test.ts` "create appends at the lowest priority…", "edit, delete, set deadline, set contribution, link purchase"; picture: `app/windows/goals/GoalsWindow.test.tsx` "a missing picture shows the placeholder and Add picture; adding one replaces it" |
| Card: picture next to a progress ring, saved/target and % | ✅ | `app/windows/goals/GoalsWindow.test.tsx` "shows each goal with its progress ring, deadline need, contribution status and projection" |
| Priority allocation after protected; withdrawals hit lowest first | ✅ | `core/balances-track/goals.test.ts` "fills protected, then goal 1, goal 2…", "withdrawals reduce the lowest-priority goals first", "balance below protected…" |
| Deadline: monthly need, ahead/behind | ✅ | `core/balances-track/goals.test.ts` "needed per month and behind amount", "ahead, reached, under a month left, and overdue" |
| Expected contribution: actual vs expected | ✅ | `core/balances-track/goals.test.ts` "current month and recent months" |
| Projected completion; both dates when later than deadline | ✅ | `core/balances-track/goals.test.ts` "shows both dates when the projection is later than the deadline" |
| Loss explained on the card | ✅ | `core/balances-track/goals.test.ts` "a withdrawal, with the transfer that caused it", "a higher-priority goal added", "reordered priorities"; `app/windows/goals/GoalsWindow.test.tsx` "explains a loss from the Oct 20 withdrawal on the card" |
| Milestones every 25% or $300, celebrated next open | ✅ | `core/balances-track/goals.test.ts` "every 25% or every $300, whichever is smaller…"; `core/balances-track/registry.test.ts` "a new goal counts the milestones its existing money already covers as celebrated; only later progress celebrates", "changing a goal's target counts newly covered progress milestones as celebrated…" |
| Completion: bigger celebration with the picture | ✅ | `app/windows/goals/GoalsWindow.test.tsx` "plays once per goal (completion is the big one with the picture)…" |
| Each milestone celebrated once | ✅ 🧑 | `core/balances-track/goals.test.ts` "each is celebrated once, even if the balance dips and recovers". M: "Each celebration plays once…" |
| Reduce motion: gentler version | ✅ 🧑 | `app/windows/goals/GoalsWindow.test.tsx` "under Reduce motion it's a gentle fade with no confetti". M: "Turn on … Reduce motion…" |
| Completed goals archived as achievements, purchase link | ✅ | `app/windows/goals/GoalsWindow.test.tsx` "archives a completed goal as an achievement through goals.archive"; `core/budgets-goals-ui.test.ts` (purchase on achievements) |
| Drag reorder, what-if, account bar, live projections | ✅ 🧑 | `app/windows/goals/GoalsWindow.test.tsx` keyboard and mouse reorder, "the what-if slider re-runs goals.whatIf…", "shows the account bar split…". M: "Drag goal priorities with a trackpad…" |
| Pictures on my Mac only; placeholder if missing | ✅ 🧑 | `app/windows/goals/GoalsWindow.test.tsx` "a missing picture shows the placeholder…" (no backend call). M: "add a goal picture: it is saved under the app data dir…" |

## 12. Trajectory

| Criterion | Status | Evidence |
|---|---|---|
| Earning vs spending by month/year with savings rate | ✅ | `core/balances-track/trajectory.test.ts` "earning vs spending with savings rate and spending share, by month and year"; `app/windows/trajectory/trajectory.test.tsx` "earning vs spending: an amount drills down…, by month and by year" |
| Investments: contributions vs growth | ✅ 🧑 | `core/balances-track/trajectory.test.ts` "investments: contributions vs growth from when history starts". M: "Investments: … 'put in' matches your own record…" |
| Interest vs principal, cumulative, per month/year | ✅ | `core/balances-track/trajectory.test.ts` "interest vs principal: cumulative principal, total interest, interest per month and year"; trajectory window interest drill test |
| Net worth stacked by account | ✅ | `app/windows/trajectory/trajectory.test.tsx` (stacks, hover) |
| Month/year views; drill where it makes sense | ✅ | `app/windows/trajectory/trajectory.test.tsx` earning (month and year) and interest drills; net worth "By month"/"By year" (`grain` toggle, open-items Phase 2); smoke drill matched |
| Projection over 1, 20, 30, 40 years | ✅ | `app/windows/trajectory/trajectory.test.tsx` "switches the horizon and labels years with no phase…"; `core/balances-track/trajectory.test.ts` "a 1-year horizon has monthly points" |
| Visible, editable assumptions | ✅ | `app/windows/trajectory/trajectory.test.tsx` "states it's a projection from my own assumptions, and editing an assumption updates it live"; `core/balances-track/trajectory.test.ts` "HYSA and cash parts compound at their own rates" |
| Life phases by year range | ✅ | `core/balances-track/trajectory.test.ts` "uses current habits first, then phases, and labels uncovered years"; window "previews a life phase live before it's saved" |
| No phase: "assumed to stay the same" | ✅ | Same tests |
| Range lower/expected/higher widening | ✅ | `core/balances-track/trajectory.test.ts` "lower / higher use return ∓ 2 points and widen over time" |
| Today's vs future dollars; inflation editable | ✅ | `core/balances-track/trajectory.test.ts` "today's dollars divide by (1 + inflation)^years"; window "toggles between today's dollars and future dollars" |
| Changing an assumption updates immediately | ✅ 🧑 | Window test above. M: "Trajectory: change an assumption → the projection moves right away…" |
| Deterministic; matches compound-interest formulas | ✅ | `core/balances-track/trajectory.test.ts` "investments with monthly contributions: FV = …", "monthly compounding at the effective rate equals annual compounding…", "is deterministic" |
| States it's a projection, not a prediction or advice | ✅ | Window test (exact disclaimer); core "/not a prediction/" |

## 13. Overview

| Criterion | Status | Evidence |
|---|---|---|
| This month's spending, by category, vs usual | ✅ | `app/windows/overview/overview.test.tsx` "each card shows what §13 asks for, with no clicks…" |
| Recent spending: latest 7–10 with merchant, category, amount, date | ✅ | Same test (≥7 rows, each matches `transactions.list`) |
| Budgets snapshot: bar with pace, parts over/running hot | ✅ | Same test (pace marker; hot parts or "Every part is on pace.") |
| Goals snapshot: picture, progress, on track | ✅ | `app/windows/overview/overview.test.tsx` "the goals card shows each goal's picture, progress and whether it's on track" (found and fixed a crash for goals without an expected contribution) |
| Net worth: total, change since last month, trend line | ✅ | `app/windows/overview/overview.test.tsx` "shows every card with real numbers…", "each card shows what §13 asks for…" ("since Sep 20", sparkline) |
| Account balances with last updated and out-of-date marker | ✅ | Same test ("Updated …"); "a bank needing reconnection… marks its accounts out of date…" |
| Everything fits at default size without scrolling | ✅ 🧑 | Smoke at 1440×900: Overview window 920×660, `.ov` scrollHeight = clientHeight (616/616), no scrolled element (one clipped meta line found and fixed). M: "Overview at its default size on your screen: everything visible without scrolling…" |
| Alerts strip only when needed (low balance, reconnect, unexplained, Needs a look) | ✅ | `app/windows/overview/overview.test.tsx` "lists a projected below-zero balance, a bank to reconnect, unexplained differences and Needs a look", "the alerts strip's Needs a look and unexplained items open the Transactions window on those views" |
| No strip when all is good | ✅ | "is empty when all is good", "shows no strip at all when nothing needs attention" |
| Goal celebrations over the Overview | ✅ 🧑 | `app/windows/goals/GoalsWindow.test.tsx` "two overlays mounted at once (Goals + Overview)…" (OverviewWindow mounts `GoalCelebrations`); smoke: the DGX Spark celebration played over the Overview. M: "Each celebration plays once…" |
| Every element clicks through | ✅ | `app/windows/overview/overview.test.tsx` "every element clicks through…"; alerts test above |
| Loads within about a second | 🧑 | Measured 95–267 ms warm, 852–865 ms cold (open-items Phase 2, `window.__ftOverviewReadyMs`). M: "Overview at its default size…" (time it on your Mac) |

## 14. Desktop shell

| Criterion | Status | Evidence |
|---|---|---|
| Each area opens as a window with title bar, minimise, maximise, close | ✅ | `app/shell/Shell.test.tsx` "first run: only the Overview, with a title bar and minimise, maximise and close"; `app/windows/windows.test.tsx` "%s is registered and has a question" (all nine) |
| Dock shows every area; opens or focuses, one window each | ✅ | `app/shell/Shell.test.tsx` "the dock opens an area or brings it to the front; one window per area; focus is visible"; `app/shell/wm/state.test.ts` "opening an open area focuses it instead of adding a second" |
| Drag by title bar, resize from edges and corners | ✅ 🧑 | `app/shell/Shell.test.tsx` "drags by the title bar and resizes from an edge, staying inside the desktop"; `app/shell/wm/state.test.ts` "resizes from every edge and corner…". M: "drag/resize stay smooth with charts" |
| Click focuses: front and visibly highlighted | ✅ | `app/shell/Shell.test.tsx` (is-focused / is-background, z-order) |
| Minimised windows go to the dock and come back | ✅ | `app/shell/Shell.test.tsx` "minimise goes to the dock and comes back from it…"; `app/shell/wm/state.test.ts` |
| Windows stay inside, title bar visible, after app resize | ✅ | `app/shell/wm/state.test.ts` "re-clamps every window when the app window shrinks", "windows that shrank with the app window grow back toward the size and place I chose" (smoke: shrank to 700×500 and back, every window returned to its size) |
| Layout restored between sessions | ✅ | `app/shell/wm/state.test.ts` "restores open/minimised, positions, sizes, stacking and focus exactly" |
| First run: only the Overview, centred | ✅ | `app/shell/wm/state.test.ts` "opens only the Overview, centred and focused"; `app/shell/Shell.test.tsx` first-run test |
| Short animations, respecting Reduce motion | ✅ | `app/shell/Shell.test.tsx` "opening animates, and under Reduce motion it doesn't" |
| Drag/resize smooth with charts | 🧑 | M: "In the real app: ⌘W closes only the in-app window, ⌘\` cycles windows, and drag/resize stay smooth with charts." |
| Shortcuts ⌘1–⌘9, ⌘W, switch windows | ✅ | `app/shell/wm/shortcuts.test.ts` "⌘1–⌘9 open the areas in dock order", "⌘W closes the focused window…", "⌘\` and ⌃Tab cycle windows, ⇧ reverses"; `app/shell/Shell.test.tsx` "⌘W closes the focused window" |
| Controls use the shared raised/pressed style | ✅ | Every control comes from `app/ui/components.tsx` (`ui-raised`); `app/ui/tokens.test.ts` "collapse the raised shadow to zero when pressed" |
| Background is the pixel-waves scene from copied parts | ✅ | `app/shell/background/scene.test.ts` "composes like register.tsx…", "has no runtime dependency on ~/.claude" |
| Background crisp, fills without stretching | ✅ | `app/shell/background/scene.test.ts` "fitScene: crisp, covering, no stretch" |

## 15. Visual style system

| Criterion | Status | Evidence |
|---|---|---|
| Each window answers one main question | ✅ 🧑 | `AREA_INFO[area].question` per area, shown in the dock tooltip and title bar; `app/windows/windows.test.tsx` "%s is registered and has a question", "the questions are all different, and each shows in the dock tooltip". Whether the content stays on one question is taste: M: "Glance at each window: it answers the question in its dock tooltip…" |
| One clear primary element; details behind a click | 🧑 | Windows use tabs/drill-downs (e.g. Spending, Trajectory, Transactions). M: "Glance at the Spending window at its default size…", and the new per-window glance line |
| Generous spacing, small set of text sizes | ✅ 🧑 | `app/ui/type-scale.test.ts` "defines six text sizes…", "every font-size outside the tokens uses a --text-* size"; spacing from `--space-*` tokens. Whether it feels generous: M: "Look over the orange/pink shades at `#styleguide`…" and the per-window glance line |
| Every control has a label or an icon with a tooltip | ✅ | `app/windows/windows.test.tsx` "%s window with data › every control has a name, and icon-only buttons have a tooltip" (all nine windows; found and fixed the Overview's untitled card arrows) |
| Every empty state says what goes there and the next step | ✅ | `app/windows/windows.test.tsx` "%s window with no data at all › loads, says what goes there and offers a next step" (added "Add a bank" to Spending, Trajectory and Investments empty states) |
| Same action looks and works the same everywhere | ✅ | Drill-down contract `app/data/drilldown.ts`; `app/windows/transactions/transactions.test.tsx` "switches on every ft:drilldown event…"; per-window drill tests; Explain via one `ExplainButton` (`app/windows/windows.test.tsx` "has an Explain button…") |
| Palette as named tokens, no one-off colours | ✅ | `app/ui/no-hex.test.ts` "no hex colours outside the token files"; `app/ui/tokens.test.ts` "tokens.ts mirrors tokens.css exactly" |
| Cream surface, white cards, blue primary, orange/pink highlights | ✅ 🧑 | `app/ui/tokens.test.ts` "define the pixel-waves palette", "include orange and pink shades". M: "Look over the orange/pink shades at `#styleguide`" |
| Each category and goal keeps its colour everywhere | ✅ | `app/ui/colorMap.test.ts` "never gives two categories the same colour", "goal colours › follow creation order, so reordering priorities never recolours"; one shared `useCategoryColors` / `goalColor` |
| WCAG AA contrast | ✅ 🧑 | `app/ui/contrast.test.ts` text pairs ≥ 4.5:1, series ≥ 3:1, axis labels. M: "Contrast check of the heatmap shades and Sankey labels…" |
| Status never colour alone | ✅ | `StatusLabel` always icon + text (`app/ui/components.tsx`); `app/windows/budgets/BudgetsWindow.test.tsx` "…with status as text"; `app/windows/overview/overview.test.tsx` goals card (`.ui-status`) |
| Shared raised controls with pressed state | ✅ | `app/ui/tokens.test.ts` "collapse the raised shadow to zero when pressed"; all buttons/tabs/toggles/dock items from `ui/components.tsx` |
| Hover, focus, pressed, disabled states consistent | 🧑 | Defined once in `app/ui/components.css`; `app/ui/contrast.test.ts` covers hover/pressed text colours. M: "Look over … `#styleguide` in a dev build" |
| Light only | ✅ | `app/ui/tokens.test.ts` "are light only" |
| Palette from the pixel-waves colours | ✅ | `app/ui/tokens.test.ts` "define the pixel-waves palette"; `app/shell/background/scene.test.ts` "the app tokens start from the scene's palette" |

## 16. AI assistant

| Criterion | Status | Evidence |
|---|---|---|
| Only runs when asked | ✅ | `api/workers/ai.test.ts` "queries, actions, the action log and the daily cron never call Gemini"; `api/node/ai-tools.test.ts` "only the /ai/chat route imports the harness…"; `app/windows/assistant/assistant.test.tsx` "says it only runs when asked and sends nothing until then" |
| Real numbers from chart queries; each figure links | ✅ 🧑 | `api/workers/ai.test.ts` "runs a read tool from the query registry and returns the answer with cited figures"; `api/node/citations.test.ts` (untagged trend amounts linked to their figure); `app/windows/assistant/assistant.test.tsx` "each cited figure links to its drill-down…". Live: `ai-live-check.md` (Uber $78.01 matched). M: "Click two or three ↗ links…" |
| Answers the three example questions; built in as prompts | ✅ 🧑 | `api/node/ai-tools.test.ts` "each names only tools that exist"; `api/workers/ai.test.ts` "sends a built-in prompt's tool guidance with the question"; `app/windows/assistant/assistant.test.tsx` "built-in prompts are one-click chips…". Quality: `ai-live-check.md`; M: "Run each built-in question once on your real data…" |
| Suggestions come with a one-click proposed action | ✅ | `api/workers/ai.test.ts` "a write tool returns a proposal with before → after and changes nothing"; assistant window proposals test |
| Never moves money; says so | ✅ 🧑 | `api/node/ai-tools.test.ts` "no action moves money", money-movement exclusion; live check (prompt 3 said to move money at the bank). M: "'Where is money going to waste…'… it says you move the actual money at your bank." |
| Parity with manual entry | ✅ | `api/node/ai-tools.test.ts` "every registry action… has an assistant tool, unless excluded with a reason", "covers the §16 groups…" |
| Excluded: connections, sign-in/security, money | ✅ | `api/node/ai-tools.test.ts` "excludes bank connections, sign-in/security and money movement, each with a reason" |
| A test lists every UI action and fails if one has no tool | ✅ | Same parity test |
| Every change waits for approval; before → after; one by one | ✅ | `api/workers/ai.test.ts` "approving one proposal applies it through /a (logged as ai) and it can be undone; the other stays unapplied"; `app/windows/assistant/assistant.test.tsx` "proposals are approved or rejected one by one…" |
| Action log and undo | ✅ | Same; `app/windows/assistant/assistant.test.tsx` "the action log lists applied changes with Undo" |
| Merchant text can't make it act | ✅ | `api/workers/ai.test.ts` "text in transaction data can only lead to a proposal, never an applied change" |
| Sees only what tools return; no account numbers, tokens, identifiers | ✅ 🧑 | `api/workers/ai.test.ts` "never sends account numbers, Plaid ids or tokens, emails or names…". M: "Open 'What was sent' and skim it…" |
| "What was sent" view | ✅ | `api/workers/ai.test.ts` "returns exactly what was sent…"; `app/windows/assistant/assistant.test.tsx` "the What was sent drawer shows exactly what went to Gemini" |
| Free-tier limit: says so and when; nothing breaks | ✅ 🧑 | `api/workers/ai.test.ts` rate-limit tests (per-minute, per-day, fallback model, retryDelay, midnight Pacific); assistant "shows a friendly message with when it can be used again when rate-limited". M: "Hit the limit…" |
| Can read transaction notes | ✅ | `api/workers/ai.test.ts` "notes are readable through the transaction queries" |
| Conversations not saved; action log kept | ✅ 🧑 | `api/workers/ai.test.ts` "a chat (with a proposal) writes nothing but the rate counters"; `app/windows/assistant/assistant.test.tsx` "keeps nothing in browser storage", "sends the whole conversation (from memory) on the next turn". M: "Close the assistant window and reopen it: the conversation is gone." |

## 17. Investments

| Criterion | Status | Evidence |
|---|---|---|
| Investments window: value and holdings (name, ticker, quantity, value, share) | ✅ 🧑 | `app/windows/investments/investments.test.tsx` "shows each account's value and holdings…"; `core/balances-track/investments.test.ts` "holdings per account…". M: "Investments: holdings and values match your brokerage…" |
| Allocation by type and by holding | ✅ | `core/balances-track/investments.test.ts` "allocation by type and by holding across accounts"; window "breaks the allocation down by type and by holding" |
| Performance vs put in, from transfers (not cost basis) | ✅ | `core/balances-track/investments.test.ts` "per account and in total, in dollars and percent", "contribution items come from transfer activity and linked transfer halves only", "the query's transfers figure drills to the bank transactions…"; window "compares what I put in (from transfers in, not cost basis)…" |
| Activity listed with notes; dividends income, buys/sells neither | ✅ 🧑 | `core/balances-track/investments.test.ts` "buys/sells are neither spending nor income, dividends are income, fees are fees"; window "lists buys, sells, dividends and fees…"; `core/balances-track/investmentNote.test.ts`. M: "Investments: add a note to a dividend and see it after a sync" |
| Holdings refresh with sync and Refresh; feed net worth and snapshots | ✅ | `api/workers/sync.test.ts` "syncs holdings, investment activity…", "calls investments refresh only for items with Investments"; `core/balances-track/snapshots.test.ts` "snapshots investment accounts at the total value of their holdings" |
| History from connection; says where it starts | ✅ | `core/balances-track/investments.test.ts` "keeps history from connection with a history-starts marker"; window ("Holdings history starts Sep 1, 2026") |

## Phase 4 smoke run (2026-11-18)

`npm run reset:dev`, API on :8806, Vite on :1436 with the dev auth bypass, built-in browser at 1440×900. No console errors. Gemini was never called (no chip, no message, no Explain click).

- Every window opened from the dock. Drill-downs checked against the Transactions total: Overview spending $2,291.50 = $2,291.50; Spending income $5,000.00 = $5,000.00; Budgets "spent $2,292" → $2,291.50; Trajectory earning (Nov) $5,000.00 = $5,000.00; Balance check "Everyday Checking money out" $2,722.07 = $2,722.07. Recurring (the seed links no transactions to recurring items) and Goals (all goals funded) had no figure to drill.
- Overview alert "4 items in Needs a look · Review" opened Transactions on Needs a look; Balance check and Poker views rendered.
- Recurring: "Everyday Credit Card is paid from" showed Everyday Checking.
- Overview at its default size: no scrolling. Found: the recent-spending meta line was clipped by 3 px (fixed).
- App window shrunk to 700×500 and back: every window returned to its remembered size.
