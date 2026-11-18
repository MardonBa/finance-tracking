# Plaid Hosted Link spike (Sandbox), Phase 1 backend

**Question (§3):** can the desktop app connect banks, including OAuth banks like Chase, by running Plaid Link in the **system browser** (Hosted Link) and returning to the app through `financetracker://`, with the backend collecting the result from Plaid directly?

**Answer:** yes, as far as can be proven without a browser. Everything server-side works against Sandbox. The browser half (signing in on Plaid's Hosted Link page, the OAuth bank's page, and Plaid redirecting at the end) needs one human run. It is on the checklist below.

Script: `apps/api/scripts/plaid-spike.ts`. Run on 2026-11-18 against Sandbox:

```bash
cd apps/api && node --env-file=.dev.vars --experimental-strip-types --no-warnings scripts/plaid-spike.ts
```

## What worked (headless, Sandbox)

| Step | Result |
|---|---|
| `/link/token/create` with `hosted_link: { completion_redirect_uri, url_lifetime_seconds }`, `products: ["transactions"]`, `optional_products: ["investments", "liabilities"]`, `transactions.days_requested: 730` | OK, returns `hosted_link_url` on `https://secure.plaid.com/hl/…` |
| `completion_redirect_uri` forms | Plaid **accepted** all of them at token creation: an https URL, `http://localhost:8787/…`, and the custom scheme `financetracker://plaid-complete?…`. Whether it actually redirects to a custom scheme at the end can only be seen in a browser, so we **always** use our https page `/plaid/redirect?session=<id>`, which hands off to `financetracker://plaid-complete?session=<id>` (§3 fallback, used in every case). |
| Opening the Hosted Link URL without a browser (curl-style fetch) | `302` → `secure.plaid.com/link/v2/stable/hosted-link.html` → `200 text/html`, title "Connect with Plaid". The session exists and is served. The page is a JS app, so nothing further happens without a browser. |
| `/link/token/get` before the user acts | `link_sessions: []`. Our finalize returns `pending` (HTTP 202) and saves nothing. |
| Sandbox OAuth bank **`ins_127287` (Platypus OAuth Bank)** via `/sandbox/public_token/create` → exchange → `/item/get` → `/accounts/get` | OK: 14 accounts (checking, savings, CD, two credit cards, IRA, 401k, loans…). Asked for transactions + investments + liabilities, `item.products` lists all three. `consent_expiration_time` is `null` in Sandbox, so the consent-expiry warning is tested with the fake Plaid and the `PENDING_EXPIRATION` webhook. |
| Update mode (reconnect) for the OAuth item: `/link/token/create` with `access_token` and no products | OK, Hosted Link URL returned. |
| `/sandbox/item/reset_login` → `/item/get` | `item.error = ITEM_LOGIN_REQUIRED`. The app prompts to reconnect. |
| `/link/token/create` with `institution_id: "ins_127287"` (skip the bank search) | **INVALID_INSTITUTION** in Sandbox. We don't pre-select institutions, so it doesn't matter. |
| Investments/Liabilities on a **transactions-only** item | Plaid **answers** (and so would add the product to the item). Sync therefore only calls them when `/item/get` lists the product. |
| `/transactions/refresh`, `/investments/refresh` | OK in Sandbox, with no rate limit seen. Rate-limit handling is tested with the fake Plaid (backs off 1 hour, `TODO(revisit)`). |

How the result is collected (built and tested): the app, after the deep link, calls `POST /connections/finalize {sessionId}`. The backend calls `/link/token/get`, takes `link_sessions[].results.item_add_results[].public_token`, exchanges it, encrypts the access token with `TOKEN_ENC_KEY`, fetches and trims the accounts, checks for duplicates, and saves item + accounts in **one** D1 batch. The `LINK: SESSION_FINISHED` webhook runs the same code. A session is claimed atomically, so the two never double-save. Only our own session id (`ls_…`) travels through the redirect, never a Plaid token.

## Needs a human browser step (manual checklist)

1. **Hosted Link in Sandbox, non-OAuth bank:** start a session (the app's "Add account", or `POST /connections/link`), open `hostedLinkUrl` in Safari, pick "First Platypus Bank", sign in with `user_good` / `pass_good`. Check that Plaid redirects to `/plaid/redirect?session=…`, the page opens the app (`financetracker://plaid-complete?session=…`), and the app's finalize returns `done` with the accounts.
2. **Sandbox OAuth bank:** same, with "Platypus OAuth Bank" (`ins_127287`). Check that you go through the bank's OAuth page and land back in the app with the connection finished.
3. **Cancel partway:** close Link or press back. Finalize returns `cancelled` and nothing is saved.
4. **Webhook delivery:** Plaid can't reach local `wrangler dev`. Deploy the dev Worker (`docs/shipping.md`), set `PUBLIC_API_URL` in `[env.dev.vars]` to its https URL, connect a bank, then fire a Sandbox webhook (command below). Check the Worker logs show the webhook verified and the item synced. Signature verification itself is covered by tests with a locally generated ES256 key (`test/workers/webhook.test.ts`).
5. **Real Chase (production, later):** complete Chase's OAuth registration in the Plaid dashboard first (decision 002).

## End-to-end run (Sandbox + local `wrangler dev`)

Script: `apps/api/scripts/e2e-sandbox.ts`. Commands, run on 2026-11-18:

```bash
npm run reset:dev
```

```bash
cd apps/api && npx wrangler dev --env dev --port 8787 --test-scheduled
```

```bash
cd apps/api && node --env-file=.dev.vars --experimental-strip-types --no-warnings scripts/e2e-sandbox.ts
```

It talks to the local Worker with `DEV_APP_TOKEN`. Banks are connected through `POST /dev/sandbox/connect` (dev + Sandbox only; 404 elsewhere), which creates a real Hosted Link session and then finishes it with a `/sandbox/public_token/create` token through the **same** exchange/encrypt/save code as a real Link result. Result: **ALL CHECKS PASSED**:

- health public; unauthenticated → empty 401; trial limit `{count, limit: 10, remaining, status}`
- Hosted Link session created (`https://secure.plaid.com/…`); finalize before finishing → `pending`; redirect page hands off to `financetracker://plaid-complete?session=…`
- connected `ins_109508` with `user_transactions_dynamic` (7 accounts) and `ins_127287` Platypus OAuth Bank with investments + liabilities (14 accounts); connecting the OAuth bank again → `duplicate` (same institution) → discarded, nothing counted twice; access token stored as `v1:` ciphertext
- after the import: 1003 Plaid transactions, 16 holdings, 1183 investment transactions, 2 credit liabilities, 16 recurring streams
- Refresh → `up_to_date` for both Sandbox banks, while the seed's fake item failed alone (`INVALID_ACCESS_TOKEN`)
- second sync and two cron runs: **no duplicate transactions** (count = distinct `plaid_transaction_id`: 1003 → 1021 as the dynamic user posted new ones)
- daily cron: a snapshot for every account with a balance (26/26)
- `/sandbox/item/fire_webhook` (`SYNC_UPDATES_AVAILABLE`) accepted by Plaid (`webhook_fired: true`); an unsigned POST to `/plaid/webhook` → empty 401
- `/sandbox/item/reset_login` → Refresh reports `ITEM_LOGIN_REQUIRED` ("First Platypus Bank needs you to sign in again"); `/connections` shows `needsReconnect` with Plaid's last successful update; update-mode session created
- weekly backup cron wrote `backups/<today>.json.enc` to local R2; `npm run restore -- <today> --dry-run` decrypts it (row counts printed); a real restore into the non-empty database is refused

Fire a Sandbox webhook at a deployed dev Worker (checklist step 4):

```bash
curl -s -X POST https://<dev worker>/dev/sandbox/fire-webhook -H "authorization: Bearer $APP_TOKEN" -H 'content-type: application/json' -d '{"itemId":"<item id>","code":"SYNC_UPDATES_AVAILABLE"}'
```

Locally the Sandbox items get the webhook URL `https://unreachable-local-dev.invalid/plaid/webhook`, a reserved name that never resolves. It lets Plaid fire without sending anything anywhere.

## Sandbox quirks found

- The first `/transactions/sync` right after connecting returns nothing (`NOT_READY`), and history arrives a few seconds later. `/connections` shows `importStatus: "importing"` until `HISTORICAL_UPDATE_COMPLETE`.
- `user_transactions_dynamic` keeps adding transactions between syncs, so counts grow but never duplicate.
