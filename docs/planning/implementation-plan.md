# Implementation plan: Finance Tracker v1 (all of success-criteria.md)

## Context
The repo is a bare Tauri 2 + React template plus planning docs. `docs/planning/success-criteria.md` defines 17 areas (§0–§17) of checkable "Done when" items; `design.md` and `decisions.md` (001–006) fix the architecture: Tauri desktop client, Cloudflare Workers + D1 backend holding all data, Plaid (read-only, Sandbox in dev), Google sign-in + Touch ID, Gemini for on-demand AI. Goal: build the whole first version and verify every checkbox. You have Plaid Sandbox keys, a Cloudflare account, a Google OAuth client and a Gemini key. Hands-on checks (Touch ID prompt, Chase OAuth in a browser, real production fixtures, production deploy) are built and tested automatically, then handed to you as a short checklist; the goal stays open until you confirm them.

## Architecture (settles the doc's open choices)
npm-workspaces monorepo, Vitest everywhere, one `npm test` (plus `cargo test`).

```
apps/desktop/        Tauri app (current src/ + src-tauri/ moved here)
  src/shell/         window manager, dock, layout persistence, shortcuts, background
  src/ui/            design tokens + raised component set + chart theme (ECharts)
  src/windows/       Overview, Spending, Budgets, Goals, Recurring, Trajectory, Investments, Transactions, Assistant
  src-tauri/         Rust: Touch ID (LocalAuthentication), Keychain, deep links, Google OAuth loopback (PKCE), 72h lock
apps/api/            Cloudflare Worker (Hono): routes, D1 (Drizzle schema, every column commented with its reason), cron, webhooks, R2 backups, Gemini harness
packages/core/       pure money math + types + zod schemas + the query and action registries (shared by UI, API, AI)
```

Key design rules that make several criteria true by construction:
- **Cents everywhere**: `toCents()` is the only Plaid-decimal conversion, applied at ingest.
- **Pure functions**: every calculation takes `(data, today, params)`; no clock, network or DB inside `packages/core`. Enforced by a lint rule banning `Date.now`/`new Date()`/`fetch` in core.
- **Provenance**: every aggregate returns the transaction IDs behind each number, so drill-down totals always equal the clicked number (one generic test runs this for every query).
- **Query registry**: each visualization is a named query in `packages/core/queries/*`. The API serves them at `/q/:name`; the AI's read tools are generated from the same registry, so there is no AI-only data access.
- **Action registry**: every mutation (recategorise, split, budget edit, goal reorder…) is a named action with a zod schema and an inverse (for undo), served at `/a/:name`. AI write tools come from the same registry minus an excluded list (bank connections, auth, money movement). The parity test is a simple diff.
- **Registries are composed from per-module files**, so parallel tracks don't edit the same file.
- **Plaid client**: a fetch client typed with the official `plaid` SDK types, an allowlist of read-only endpoints (test fails on additions), zod validation of every response, and `trim*()` functions that drop fields before anything is saved.
- **Environments**: `wrangler.toml` `env.dev` (Sandbox, D1 `ft-dev`, R2 `ft-backups-dev`) and `env.production` (separate D1, R2, secrets). Secrets come from the root `.env` (gitignored, already filled and checked: Plaid Sandbox 200, Gemini 200, Google client ID well-formed; Wrangler logged in to one account). Phase 0 adds a `scripts/sync-dev-vars` step that feeds `.env` into Wrangler's local dev and `wrangler secret put` for the deployed dev Worker; values are never printed or committed. Generated secrets (token-encryption key, backup key, app-token pepper) are created by a script straight into `.env`/Wrangler. `.env.example` (currently untracked) gets committed and extended. The production Plaid secret isn't in `.env` yet; that goes on your manual checklist.
- **Gemini free tier**: the model name is config (default `gemini-2.5-flash`, with `flash-lite` as a fallback). Automated tests never call Gemini; they use recorded responses and a fake client. The backend throttles requests (requests-per-minute and per-day counters in D1), honours 429 `retryDelay`, and turns limit errors into the "available again at …" message. Live checks of the AI features run as a small, counted set of real calls (about 10 per verification pass), one at a time, spaced out, never in parallel sessions.

## Orchestration
- I orchestrate from `main`. Implementation sessions are local sessions in their own **git worktrees** (branch `feat/<track>`), merged into `main` by me after I review the diff and tests pass. Single sequential steps use a plain branch, then merge.
- Every brief tells the session to use **Explore subagents on Haiku 5.5** for search and exploration, keep implementation on its own model, and use **Fable 5.2** only for a problem it can't resolve.
- Each session ends with its criteria checklist: which checkboxes it covered, with the test or evidence for each.

## Phases

### Phase 0: Foundation (sequential, branch `phase0-foundation`, one session)
Monorepo move, Vitest, Wrangler, `npm run dev` (Wrangler dev + Tauri dev with hot reload, one command), `npm test`, `npm run reset:dev` (reset D1 + seed from Sandbox), full D1 schema + migrations, core types, `toCents`, Plaid client skeleton (allowlist, zod, trim), registry skeletons + `/q` `/a` routes, auth middleware stub, design tokens file, `docs/shipping.md` deploy routine.
Phase 0 also creates the Cloudflare dev resources (D1 `ft-dev`, R2 bucket) with the logged-in Wrangler.

### Phase 1: Platform (4 parallel worktrees)
| Track | Scope | Criteria |
|---|---|---|
| **core-flows** | classification into spending/income/transfer/Poker, transfer matching, refunds, splits, income layers, Poker net, rule order, reconciliation, "Needs a look", usual (1–3 months), Worth a look, budgets (parts, tag priority, trips, pace, projection, track record) + invariant tests | §1 math, §6, §8 logic, §10 logic |
| **core-balances** | snapshots (daily, weekly downsample after 90 days, gaps), balance rebuild + replay test, net worth, goal allocation + protected amount + milestones, recurring projection + lowest point, trajectory projections (phases, range, inflation, compound-interest tests), investment performance from transfers in | §5, §9, §11, §12, §17 logic |
| **backend** | Google ID-token check (only your account), app tokens (hashed, revocable), 401-without-data test on every route, Plaid Hosted Link **Sandbox spike first** (incl. OAuth test bank), redirect page → `financetracker://`, token exchange + encryption, 24-month history, duplicate-bank detection, Trial-limit check, `/transactions/sync` cursor sync (idempotent, pending→posted with edits kept, removals flagged), signed webhooks, daily cron, Refresh, item health/expiry, investments + liabilities sync, R2 encrypted weekly backups + restore script + test | §2, §3 backend, §4 |
| **shell** | window manager (drag, resize, clamp, focus, minimise, one window per area), dock, layout persistence, first-run Overview, ⌘1–9/⌘W/switch, animations with Reduce motion, pixel-waves background ported into the repo (crisp, no stretch), raised component set with all states, chart theme, category/goal colour map, WCAG AA contrast test; Rust: Touch ID, Keychain gated by Touch ID, 72h relock, deep-link plugin, Google OAuth loopback | §14, §15, §2 client side |

core-flows and core-balances work in separate folders of `packages/core`; the backend and shell tracks don't touch core except by importing it.

### Phase 2: Feature windows (4 parallel worktrees, after Phase 1 is merged)
Each track adds its own queries and actions (per-module files) plus its window(s):
| Track | Windows | Criteria |
|---|---|---|
| **onboarding-overview** | first-run flow (Google → Touch ID → add banks), accounts found / add another / finish, rename/hide/retype, import status, manual cash accounts, reconnect prompt after Touch ID, out-of-date markers, Overview (all cards, alerts strip, celebrations overlay, no scrolling, <1s load) | §3 UI, §4 UI, §13 |
| **transactions-spending** | Transactions list (filters, search, notes, row markers, row fixes), merchant view + merge/separate, drill-down filter header, Spending (monthly summary, Sankey, small multiples, top merchants, heatmap, saved by destination, necessary labels, Worth a look, cutting back) | §7, §8 |
| **budgets-goals** | Budgets (parts, Everything else, trips, pace bars, pending faded, planned vs actual, history grid, track record), Goals (cards with local images, ring, deadline/contribution status, projections, withdrawal explanations, celebrations, archive, drag reorder with keyboard, what-if, account bar) | §10, §11 |
| **recurring-trajectory-invest** | Recurring (upcoming view, card payments, below-zero warning, list, calendar, estimates, edit), Trajectory (earning vs spending, investments, interest vs principal, net worth stacked, projections with phases/range/inflation toggle), Investments (holdings, allocation, performance, activity) | §5 UI, §9, §12, §17 |

### Phase 3: AI assistant (one branch)
Gemini function calling from the Worker; read tools generated from the query registry, write tools from the action registry → proposals with before/after, approve or reject one by one, action log + undo, the three built-in prompts, figures linked to their drill-down, "what was sent" view, free-tier limit message, conversation kept in app memory only, parity test. §16.

### Phase 4: Integration and verification
- Me + one verification session: walk every checkbox in §0–§17, record evidence in `docs/planning/criteria-verification.md` (test name or check), tick the box in `success-criteria.md`, fix gaps on short branches.
- Create Cloudflare dev + production resources, deploy both, build the `.app` with the documented routine.
- Hand you the manual checklist: Touch ID and relock, Google sign-in with a non-allowed account refused, Chase OAuth in Sandbox, real production Plaid connection, saving anonymised production responses as fixtures (then the fixture schema test runs on them), restore-from-backup run, contrast check sign-off.

## Verification
- `npm test` (Vitest: core math + invariants + provenance/drill-down totals + registry parity + Plaid allowlist + trim + auth on every route) and `cargo test`, required before each merge into `main`.
- `npm run dev` against the dev Worker + Sandbox seed; each window checked in the running app (screenshots via the run skill).
- `npm run reset:dev` restores the known starting state; a backup → restore round trip runs against local D1/R2.
- Goal done when every checkbox has evidence and your manual checklist is confirmed.
