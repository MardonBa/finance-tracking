# Backup and restore

Two layers protect the data (§2 "Nothing is lost"):

| Layer | What | How far back | Use it for |
|---|---|---|---|
| **D1 Time Travel** | Cloudflare's built-in point-in-time restore of the whole database | **7 days on the Workers Free plan** (30 days on Workers Paid), checked 2026-11-18 at developers.cloudflare.com/d1/reference/time-travel | A bad migration or a bad deploy in the last week |
| **Weekly encrypted backups (R2)** | A file per week in the R2 bucket, encrypted with `BACKUP_ENC_KEY` | The last 12 weeks (`BACKUP_RETENTION`, `TODO(revisit)`) | Anything older than a week, or losing the database entirely |

## What a backup contains

`apps/api/src/backup/format.ts` (`BACKUP_TABLES`):

- **Edits that can't be fetched from Plaid again:** transaction overrides (category, bucket, necessity, notes), tags, splits, transfer and refund links, merchant groups and aliases, rules, necessary labels, cutting back, budgets (amounts, parts, targets), trips, goals and milestones seen, recurring edits (`recurring_overrides`), balance snapshots, manual accounts and their transactions, the action log, and the trajectory assumptions and life phases (`trajectory_assumptions` and `life_phases`, skipped until their migration exists).
- **The Plaid rows those edits point at:** items, accounts, transactions, securities, recurring streams, liabilities, holdings, investment activity. Without them a restore would break foreign keys. Keeping them also preserves history older than Plaid's 24 months. Plaid access tokens stay encrypted with `TOKEN_ENC_KEY` inside the backup, which is itself encrypted.
- **Not included:** app credentials (after a restore, sign in with Google again), `sync_runs`, `link_sessions` and `ai_rate_counters`. These are transient.

File format: `"FTB1"` + 12-byte IV + AES-GCM-256(gzip(JSON)), stored at `backups/YYYY-MM-DD.json.enc` (the user's local date). The cron `0 12 * * SUN` (`apps/api/wrangler.toml`) writes one each week and deletes all but the newest 12.

## Restore into a fresh database

The restore script (`apps/api/scripts/restore.ts`) downloads the file from R2, decrypts it, applies the migrations to the target D1, refuses if the target already has accounts or transactions, and loads every row. It prints counts only, never data.

Dev (local D1 and local R2, using `BACKUP_ENC_KEY` from `apps/api/.dev.vars`):

```bash
npm run restore -- backups/2026-11-22.json.enc
```

Dev, deployed D1:

```bash
npm run restore -- 2026-11-22 --remote
```

Check a backup without changing anything:

```bash
npm run restore -- 2026-11-22 --remote --dry-run
```

Production. The key is the one you set with `wrangler secret put BACKUP_ENC_KEY --env production`, so put it in your shell only for this command. Restore into a **new** database, then point the Worker at it:

```bash
cd apps/api && npx wrangler d1 create ft-prod-restore
```

Paste the new `database_id` into `[env.production]` in `wrangler.toml`, then:

```bash
BACKUP_ENC_KEY='<production backup key>' npm run restore -- 2026-11-22 --env production --remote
```

```bash
cd apps/api && npx wrangler deploy --env production
```

A backup file you have already downloaded can be restored with `--from-file <path>` in place of the key.

**Tested:** `apps/api/test/workers/backup.test.ts` ("backup → fresh database → restore gives identical rows") backs up the full fixture, wipes the database, re-applies the migrations, restores, and compares every row of every table. It runs in `npm test`. A manual run against a deployed database is on the user's checklist (`docs/planning/open-items.md`).

## D1 Time Travel

Find a point in time, then restore it. Restoring overwrites the database in place, and its output includes a bookmark that undoes the restore:

```bash
cd apps/api && npx wrangler d1 time-travel info ft-prod --env production
```

```bash
cd apps/api && npx wrangler d1 time-travel restore ft-prod --env production --timestamp=<unix seconds or RFC3339>
```

## If the laptop is lost

Revoke every app credential. Either sign in from the app on another Mac and use `POST /auth/revoke {"all": true}`, or run this directly:

```bash
cd apps/api && npx wrangler d1 execute DB --env production --remote --command "UPDATE app_credentials SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL"
```
