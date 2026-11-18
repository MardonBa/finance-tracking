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
