# Finance Tracker

Personal macOS app that pulls in bank and investment data (Plaid, read-only), shows where money goes and comes from, tracks budgets and goals, and answers questions with Gemini on demand.

Stack: Tauri 2 + React + TypeScript desktop app, Cloudflare Workers + D1 backend (Hono, Drizzle), shared pure-TS core. See [decisions.md](./decisions.md) and [docs/planning](./docs/planning).

## Prerequisites

- Node 22+ and npm 11+
- Rust (`~/.cargo/bin` does not need to be on PATH; the scripts add it)
- Xcode Command Line Tools
- `wrangler login` (Cloudflare account) for deploys and creating resources

## First-time setup

```bash
npm install
```

```bash
cp .env.example .env   # then fill in Plaid Sandbox, Google and Gemini values
```

```bash
npm run gen:secrets    # creates TOKEN_ENC_KEY, BACKUP_ENC_KEY, APP_TOKEN_PEPPER, DEV_APP_TOKEN in .env
```

```bash
npm run reset:dev      # local dev D1: migrate + deterministic seed + dev app credential
```

## Daily commands

| Command | What it does |
|---|---|
| `npm run dev` | One command for local dev: `wrangler dev --env dev` (local D1/R2, auto-reloads on backend edits) and `tauri dev` (Vite hot reload for the frontend). Writes `apps/api/.dev.vars` from `.env` first. |
| `npm test` | All Vitest suites (core, API in Node and in the Workers runtime against local D1, desktop) then `cargo test`. Must pass before shipping. |
| `npm run typecheck` | `tsc` for every workspace (includes the schema ↔ core and Plaid schema ↔ SDK type checks). |
| `npm run reset:dev` | Drop and re-migrate the local dev D1, load the deterministic seed. `-- --today YYYY-MM-DD` pins the seed date; `-- --sandbox` also creates Plaid Sandbox items from `apps/api/seed/custom-users`. |
| `npm run sync:dev-vars` | Rewrite `apps/api/.dev.vars` and `apps/desktop/.env.development.local` from `.env` (`-- --deployed` also pushes the secrets to the deployed dev Worker). |
| `npm run db:generate -w @ft/api` | After editing `apps/api/src/db/schema.ts`: generate the next SQL migration. |

Shipping (deploy the Worker, build the `.app`): [docs/shipping.md](./docs/shipping.md).

## Layout

```
apps/desktop/        Tauri app: src/ (React), src-tauri/ (Rust), src/ui/tokens.css (design tokens), src/api/client.ts
apps/api/            Cloudflare Worker: src/index.ts (Hono app), src/db (schema, migrations bridge), src/plaid, seed/, migrations/
packages/core/       @ft/core: money (toCents, Money), dates, domain types, query/action registries, fixtures
scripts/             gen-secrets, sync-dev-vars, reset-dev
```

## Desktop app (shell)

- **Sign-in:** first run is Google sign-in (system browser, PKCE, loopback on 127.0.0.1) → Touch ID setup → desktop; later launches ask for Touch ID first, and again after 72 hours. The credential lives in the macOS Keychain. To skip both in local dev: `VITE_DEV_AUTH_BYPASS=1 npm run dev` (uses `DEV_APP_TOKEN`; dev builds only).
- **Adding a window (Phase 2):** create `apps/desktop/src/windows/<name>/window.tsx` with `export default defineWindow({ area: "spending", component: SpendingWindow })` (from `src/shell/registry.ts`). It replaces that area's placeholder; `useWindow()` gives the area, the app token and window actions. First-run steps (e.g. add banks) go in `apps/desktop/src/onboarding/<name>.tsx` via `defineOnboardingStep`.
- **Styleguide:** open `#styleguide` in a dev build to see every component and state.
- **Colours:** only `src/ui/tokens.css` / `tokens.ts` define colours (a test enforces it); charts use `src/ui/Chart.tsx` and `colorMap.ts` so a category keeps its colour everywhere.

## Rules that keep the numbers right

- Money is integer cents everywhere. `toCents()` in `@ft/core` is the only decimal → cents conversion.
- `packages/core/src` is pure: no clock, network or randomness (a test walks the AST). "Today" and ids are passed in.
- Every query returns `figures` (provenance: the transactions behind each number); every action returns row mutations and gets an inverse for undo.
- Add queries/actions in `packages/core/src/{queries,actions}/<module>/` and that module's `index.ts` only.
- The Plaid client can only call the read-only allowlist in `apps/api/src/plaid/endpoints.ts`.
- Every D1 column has a comment giving the reason it is stored.
