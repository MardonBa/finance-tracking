# Shipping

Manual routine (no CI/CD yet, §1). A finished change can be in daily use the same day: test, migrate, deploy the Worker, build the app. Three commands:

```bash
npm run ship:api:dev
```

```bash
npm run ship:api:prod
```

```bash
VITE_API_URL=https://ft-api.<your-subdomain>.workers.dev npm run ship:app
```

Each one runs `npm run ship:check` (typecheck + every test) first and stops if anything fails. `apps/api/test/node/shipping.test.ts` fails if a `ship:*` script stops doing that.

## 0. Tests gate everything

```bash
npm run ship:check
```

That's `npm run typecheck && npm test`. `npm test` runs every Vitest suite (core math and purity, registry invariants, API routes and auth in the Workers runtime against a local D1 with the real migrations, schema rules, Plaid allowlist/schemas/trimming against saved Sandbox fixtures) and `cargo test`. **If anything fails, do not ship.** There is no override.

## 1. Backend (Cloudflare Worker)

Always name the environment. Dev and production have separate D1 databases, R2 buckets and secrets (`apps/api/wrangler.toml`).

### Dev Worker (Plaid Sandbox)

`npm run ship:api:dev` does, after the tests:

```bash
cd apps/api && npx wrangler d1 migrations apply DB --remote --env dev
```

```bash
cd apps/api && npx wrangler deploy --env dev
```

Secrets for the deployed dev Worker come from the root `.env` (Sandbox values only):

```bash
npm run sync:dev-vars -- --deployed
```

### Production Worker (real accounts)

One-time setup (Phase 4): create the resources and paste the D1 id into `wrangler.toml` (replacing the placeholder):

```bash
cd apps/api && npx wrangler d1 create ft-prod
```

```bash
cd apps/api && npx wrangler r2 bucket create ft-backups-prod
```

Set each production secret by hand (values are typed at the prompt, never stored in the repo or `.env`): `PLAID_CLIENT_ID`, `PLAID_SECRET` (the production secret), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `ALLOWED_GOOGLE_SUB` (or `ALLOWED_GOOGLE_EMAIL`), and fresh `TOKEN_ENC_KEY`, `BACKUP_ENC_KEY`, `APP_TOKEN_PEPPER` (generate with `openssl rand -base64 32`; never reuse the dev ones):

```bash
cd apps/api && npx wrangler secret put PLAID_SECRET --env production
```

Each release, `npm run ship:api:prod` does, after the tests:

```bash
cd apps/api && npx wrangler d1 migrations apply DB --remote --env production
```

```bash
cd apps/api && npx wrangler deploy --env production
```

Migrations are forward-only and applied before the deploy so the new code never runs against an old schema. D1 Time Travel can restore the database to a point before a bad migration (`npx wrangler d1 time-travel restore ft-prod --env production --timestamp <iso>`).

## 2. Desktop app

Point the build at the production Worker URL; `npm run ship:app` runs the tests, refuses to build without `VITE_API_URL`, then builds:

```bash
VITE_API_URL=https://ft-api.<your-subdomain>.workers.dev npm run ship:app
```

The `.app` is in `apps/desktop/src-tauri/target/release/bundle/macos/`. Copy it to `/Applications` (replace the old one). `VITE_DEV_APP_TOKEN` is only read in dev builds; production builds sign in with Google.

## Checklist

1. `npm run ship:check` passes (the ship scripts run it for you).
2. `npm run ship:api:dev` (migrations + deploy), smoke-check `/health`.
3. `npm run ship:api:prod`.
4. `npm run ship:app` against the production URL, then install the `.app`.
