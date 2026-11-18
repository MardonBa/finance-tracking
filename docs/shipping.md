# Shipping

Manual routine (no CI/CD yet, §1). A finished change can be in daily use the same day: test, migrate, deploy the Worker, build the app.

## 0. Tests gate everything

```bash
npm run typecheck && npm test
```

`npm test` runs every Vitest suite (core math and purity, registry invariants, API routes and auth in the Workers runtime against a local D1 with the real migrations, schema rules, Plaid allowlist/schemas/trimming against saved Sandbox fixtures) and `cargo test`. **If anything fails, do not ship.** There is no override.

## 1. Backend (Cloudflare Worker)

Always name the environment. Dev and production have separate D1 databases, R2 buckets and secrets (`apps/api/wrangler.toml`).

### Dev Worker (Plaid Sandbox)

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

Each release:

```bash
cd apps/api && npx wrangler d1 migrations apply DB --remote --env production
```

```bash
cd apps/api && npx wrangler deploy --env production
```

Migrations are forward-only and applied before the deploy so the new code never runs against an old schema. D1 Time Travel can restore the database to a point before a bad migration (`npx wrangler d1 time-travel restore ft-prod --env production --timestamp <iso>`).

## 2. Desktop app

Point the build at the production Worker URL, then build:

```bash
cd apps/desktop && VITE_API_URL=https://ft-api.<your-subdomain>.workers.dev npm run tauri build
```

The `.app` is in `apps/desktop/src-tauri/target/release/bundle/macos/`. Copy it to `/Applications` (replace the old one). `VITE_DEV_APP_TOKEN` is only read in dev builds; production builds sign in with Google.

## Checklist

1. `npm run typecheck && npm test` pass.
2. New migration? Applied to dev, then production.
3. Worker deployed to dev, smoke-checked (`/health`), then production.
4. `.app` built against the production URL and installed.
