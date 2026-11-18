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

## 003: Small backend for Plaid and AI

**Date:** 2026-11-17
**Status:** Proposed (not yet built)

**Decision:** Add a small TypeScript backend, likely Cloudflare Workers + D1. The desktop app talks to it over HTTPS.

**Why:**
- **Secrets stay off the client.** The Plaid secret and the per-bank access tokens shouldn't live in the desktop app.
- **Webhooks need a public URL.** Plaid announces new transactions via webhooks (`SYNC_UPDATES_AVAILABLE`).
- **Snapshots for trajectories.** Plaid only gives *current* balances and holdings, so a scheduled job (cron) has to snapshot them daily for history.
- **AI calls go server-side.** Claude API calls run on the backend with tool use (e.g. `spending_by_category`, `net_worth_series`), so the model computes from real data instead of doing arithmetic over raw dumps.

**Open questions:** Workers + D1 vs. a Node service on Fly.io or Railway; how the app authenticates to the backend (single-user, so probably a long-lived token stored in the Keychain).

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

**Why:** Transfers are the biggest source of wrong numbers, so they get both automatic and manual handling. Plaid's categories avoid maintaining our own taxonomy. Counting only cleared charges keeps totals stable. Assigning refunds to the original period reflects what the purchase really cost. A per-account income flag would misclassify reimbursements, refunds, and interest.

---

## 006: AI agent scope and connections

**Date:** 2026-11-17
**Status:** Accepted, except where marked *proposed*

**Decision:**
- **AI parity with the UI:** the agent can analyze data and do anything the UI can, through the same backend API (via harness tools).
- *Proposed:* the agent asks for confirmation before any change, and every agent change is logged and can be undone.
- *Proposed:* **privacy.** The model sees only what tools return (mostly aggregates; individual transactions only when needed). Account numbers, Plaid tokens, and personal identifiers are never sent. Each conversation has a "what was sent" view.
- **Broken connections** prompt the user to reconnect via Plaid's update mode, which keeps transaction history. Show the last successful update from Plaid, with our own last-synced time as a fallback.

**Why:** One API for both UI and agent keeps them from drifting apart. Confirmation matters because merchant names and descriptions are untrusted text that reaches the model. Sending only tool results keeps exposure minimal.

**Details:** [docs/planning/design.md](docs/planning/design.md)
