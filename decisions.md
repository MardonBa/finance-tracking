# Decisions

A running log of decisions for this project: what was decided, why, and what was traded off.
Newest at the bottom. Mark superseded entries rather than deleting them.

---

## 001: Desktop app framework: Tauri 2 + React + TypeScript

**Date:** 2026-11-17
**Status:** Accepted

**Decision:** Build the macOS app with Tauri 2, a React + TypeScript frontend (Vite), and a thin Rust shell.

**Why:**
- **Language fluency.** I'm much more fluent in TypeScript than Swift, so I'll iterate faster and keep momentum.
- **Charting and UI ecosystem.** React charting libraries (Recharts, ECharts, Visx) are far richer than Swift Charts for trajectory, net-worth, and category views.
- **One language across the stack.** The planned backend is TypeScript too, so types for accounts, transactions, and so on can be shared.
- **Small and native enough.** Tauri apps are about 10 MB (vs. 150 MB+ for Electron) and use the system WebKit, with access to native APIs (Keychain, menu bar, notifications) via Rust or plugins.
- **Portability.** The same frontend could later become a web or mobile version with little rework.

**Alternatives considered:**
- **SwiftUI:** best native look and feel, but I'm less fluent in Swift and the charting options are weaker.
- **Electron:** most mature, but heavy on size and memory for a single-user app.
- **Web app / PWA:** simplest to ship, but puts financial data behind an internet-facing login and isn't a real Mac app.
- **Streamlit / Python dashboard:** fastest prototype, but not a polished daily-use app.
- **Off-the-shelf (Monarch, Copilot, Tiller, Actual, Firefly III):** less control over analytics, AI, and the data model, which is the point of this project.

**Trade-offs accepted:** Slightly less native feel than SwiftUI, and some Rust when touching macOS APIs.

---

## 002: Bank data source: Plaid

**Date:** 2026-11-17
**Status:** Accepted (pending verification during setup)

**Decision:** Use Plaid as the primary data aggregator, on the free **Trial** plan (real production data, up to 10 Items, intended for hobbyist use).

**Why:**
- **Covers my institutions.** Chase connects via its official API (Plaid and JPMorgan signed a paid data-access agreement in Sept 2025). EverBank Personal is listed as supported by third-party trackers.
- **Covers "everything."** Plaid has Transactions (cursor-based sync), Balance, Investments (holdings and trades), and Liabilities (cards, mortgages, loans).
- **Free for this scale.** Two Items (Chase + EverBank) fit well within the Trial's 10.

**To verify during setup:**
- [ ] Sign up for the Trial and do **not** apply for full Production first. A pending or approved Production application makes the Trial unavailable, and you can't switch back on your own.
- [ ] Complete Chase's OAuth registration in the Plaid dashboard.
- [ ] Confirm the Investments and Liabilities products are included in the Trial.
- [ ] Confirm EverBank connects reliably.

**Fallbacks:**
- **SimpleFIN Bridge** (~$15/year) for any institution Plaid handles poorly (e.g. EverBank), behind the same data-source interface.
- **CSV exports** from Chase and EverBank for history older than Plaid provides.

**Alternatives considered:** Teller (good Chase support, likely no EverBank, no investments); SimpleFIN only (cheapest, but less complete investment data); MX, Finicity, Akoya (enterprise-oriented).

---

## 003: Backend: Cloudflare Workers + D1, holding all data; Gemini for AI

**Date:** 2026-11-17
**Status:** Accepted (not yet built)

**Decision:**
- **All data lives in the backend.** A TypeScript backend on **Cloudflare Workers** with a **D1** (SQLite) database is the single source of truth for transactions, user edits (overrides, rules, splits, transfer/refund links), budgets, goals, and snapshots. The desktop app is a client and talks to it over HTTPS; it keeps no local copy of financial data.
- **Free plan only.** The project should cost $0 to run. Workers' free plan covers it: about 100k requests/day, 5 GB of D1, cron triggers, and nothing to keep warm.
- **AI uses the Gemini API** (free tier at low usage) instead of Claude, called from the backend with tool use (e.g. `spending_by_category`, `net_worth_series`), so the model computes from real data instead of doing arithmetic over raw dumps.

**Why:**
- **Secrets stay off the client.** The Plaid secret, per-bank access tokens, and the Gemini key never live in the desktop app.
- **Webhooks need a public URL that's always up.** Plaid announces new transactions via webhooks (`SYNC_UPDATES_AVAILABLE`).
- **Snapshots for trajectories.** Plaid only gives *current* balances and holdings, so a daily cron job snapshots them, including when the laptop is off.
- **One API for UI and agent.** With the data next to the API, the agent's tools are thin wrappers over the same endpoints the UI uses (see 006).
- **Free, always on, no server to maintain.** Workers + D1 is the only option found that's all three.

**Alternatives considered:**
- **Data stored in the app (local SQLite), thin backend:** keeps data on the machine, but snapshots, webhooks, and the agent all need the data available server-side.
- **Vercel Hobby + Neon/Turso:** workable for free, but it's free tiers from several providers stitched together.
- **Supabase free:** projects pause after about a week of inactivity, which would silently drop webhooks and snapshots.
- **Fly.io / Railway / Render:** no usable free tier (Render's free tier sleeps, and its free database expires).
- **Oracle Always Free VM / self-hosting with Cloudflare Tunnel:** free, but means maintaining a server myself.
- **Claude API:** pay-per-use with no ongoing free tier.

**Trade-offs accepted:**
- Financial data is stored with Cloudflare (encrypted at rest by Cloudflare).
- **Free-plan limits:** 10 ms of CPU per request. Time waiting on Plaid or Gemini doesn't count, but heavy calculations or long agent loops may need batching or Durable Objects.
- **Gemini free tier:** Google may use prompts and responses to improve its products, and it has rate limits. The privacy rules in 006 (tools return mostly aggregates; identifiers never sent) matter more because of this. Moving to the paid tier would end that data use if it becomes a concern.

**Addendum (2026-11-18): login, minimal data, backups**
- **Login:** sign in with Google; the backend accepts only my Google account. The app's credential is kept in the Keychain behind **Touch ID**, required on open and again after 72 hours open. The credential can be revoked.
- **Read-only:** only read-only Plaid products are used (Transactions, Balance, Investments, Liabilities); Auth, Identity, Transfer, and Payment Initiation are never enabled, and the Plaid client is limited to an allowlist of read-only endpoints.
- **Minimal data:** only fields needed for a visualization, calculation, or rule are stored (raw bank descriptions included); no account numbers, owner identity, or location data. Plaid access tokens are encrypted with a key held in a Workers secret.
- **Backups:** data that can't be re-fetched from Plaid (my edits, budgets, goals, snapshots) is exported on a schedule, encrypted, to Cloudflare R2's free tier, alongside D1's point-in-time restore.
- **Plaid Link** runs in the system browser via Hosted Link and returns to the app with a deep link, which also handles Chase's OAuth.

**Open questions:**
- Confirm current free-plan limits (Cloudflare, Gemini) before building; they change.

**Details:** [docs/planning/success-criteria.md](docs/planning/success-criteria.md) §2–§4

---

## 004: Budget and goal mechanics

**Date:** 2026-11-17
**Status:** Accepted

**Decision:**
- **Goals are funded in priority order.** The account balance fills goal #1 to its target, then goal #2, and so on; the rest is "Unassigned". Withdrawals hit the lowest-priority goals first.
- **Each goal is tied to exactly one account.** Several goals can share one account.
- **Budget periods are custom:** weekly, biweekly, monthly, yearly, or custom dates.
- **No carryover.** Each budget period starts fresh; overspending doesn't reduce the next period.

**Why:** Fill-in-order is the simplest model to explain and visualize, and it makes priority reordering meaningful. One account per goal keeps the math tied to a real balance. Starting fresh keeps budgets easy to read.

**Addendum:** An account can hold a **protected amount** (e.g. an emergency fund) that is filled before any goal and is never assigned to goals.

**Addendum (2026-11-18): budget structure.** *Supersedes "budget = category + limit + period".* A budget is **one overall amount per period** (calendar month by default) with **parts** inside it, each with an expected amount. A part is defined by categories, merchants, or a hand-applied **tag**. Each transaction counts toward at most one part, and a tag beats a category. Whatever the parts don't cover is "Everything else". **Trips** (tagged one-off budgets) have their own start and end dates, which can span months; trip spending still counts toward each month's overall total but not toward any monthly part.

**Details:** [docs/planning/design.md](docs/planning/design.md)

---

## 005: Transaction rules

**Date:** 2026-11-17
**Status:** Accepted, except where marked *proposed*

**Decision:**
- **Transfers:** auto-detected by matching equal amounts moving out of and into linked accounts within a few days, with Plaid's transfer categories as a first signal. Auto-matches can be undone. Anything missed can be marked as a transfer manually, with an optional "always" rule. Transfers count as neither spending nor income.
- **Categories:** Plaid's categories. Users can correct individual transactions and add merchant rules.
- **Pending charges don't count** toward any total; only cleared transactions do. *Proposed:* show pending charges as a faded section on budget bars.
- *Proposed:* charges count on the **purchase date** (Plaid's authorized date) when available, otherwise the posted date.
- **Refunds count in the original purchase's period,** not the period they arrive in.
- **Splitting is manual:** a user can split one transaction across several categories.
- *Proposed:* **Income** is identified by Plaid's income categories (after excluding transfers), then payer rules, then per-transaction overrides. "Count deposits to this account as income" is a fallback setting per account, not the main mechanism.

**Addendum (2026-11-18):**
- **Unmatched transfers:** a transaction Plaid labels as a transfer with no matching other half counts as a transfer and goes into "Needs a look" until confirmed or covered by a rule.
- **Poker:** transactions can be tagged Poker (with payer/payee rules). Individual Poker transactions are neither spending nor income; the **net Poker result per period counts as income** (a net loss is negative Poker income).
- **Manual accounts:** cash is tracked as a manual account with hand-entered transactions, following the same rules; an ATM withdrawal into it is a transfer.
- **Necessary / not necessary:** I label categories and merchants myself; there are no defaults.

**Why:** Transfers are the biggest source of wrong numbers, so they get both automatic and manual handling. Plaid's categories avoid maintaining our own taxonomy. Counting only cleared charges keeps totals stable. Assigning refunds to the original period reflects what the purchase really cost. A per-account income flag would misclassify reimbursements, refunds, and interest.

---

## 006: AI agent scope and connections

**Date:** 2026-11-17
**Status:** Accepted

**Decision:**
- **AI parity with the UI:** the agent can analyze data and do anything the UI can, through the same backend API (via harness tools).
- **AI only runs when asked.** The AI never generates anything on its own: no automatic chart notes, insights, or coaching on sync or page load. Every AI output comes from a user action (asking a question, clicking "Explain this"). Unusual-spending flags stay rule-based, not AI. *(Added 2026-11-17)*
- The agent **asks for approval before any change**, showing before → after, and every agent change is logged and can be undone. *(Accepted 2026-11-18)*
- **Scope of actions:** every manual action in the UI, except connecting, reconnecting, or removing banks, sign-in and security settings, and anything that moves money. A test keeps the UI and agent actions in sync. *(Added 2026-11-18)*
- **Privacy.** The model sees only what tools return, which are the same queries the charts use (mostly aggregates; individual transactions and their notes only when needed). Account numbers, Plaid tokens, and personal identifiers are never sent. Each conversation has a "what was sent" view. *(Accepted 2026-11-18)*
- **Conversations aren't saved;** only the action log of approved changes is kept. *(Added 2026-11-18)*
- **Broken connections** prompt the user to reconnect via Plaid's update mode, which keeps transaction history. Show the last successful update from Plaid, with our own last-synced time as a fallback.

**Why:** One API for both UI and agent keeps them from drifting apart. Confirmation matters because merchant names and descriptions are untrusted text that reaches the model. Sending only tool results keeps exposure minimal. Running AI only when asked keeps it from adding noise, and keeps usage within Gemini's free tier.

**Details:** [docs/planning/design.md](docs/planning/design.md)
