# Dev seed and Plaid Sandbox users

| File | What it is |
|---|---|
| `dev-seed.ts` | Deterministic dev data (same `today` → same rows): 6 months of paychecks, rent, card purchases, card payments and checking→HYSA transfers (both halves linked), interest, a refund, a split, Poker, ATM → cash, pending → posted, holdings, dividends, a budget, goals, recurring items. Loaded by `npm run reset:dev`. |
| `build-seed-sql.ts` | Turns the seed into SQL using the real Drizzle schema, plus the `DEV_APP_TOKEN` app credential. |
| `custom-users/*.json` | Plaid Sandbox `user_custom` configs (the JSON goes in `override_password`). `everyday-bank`: checking, HYSA, credit card with liability; paychecks, transfers both ways, card purchases and payment, refund, interest, Venmo (Poker), ATM, a pending charge. `investor`: brokerage with holdings, deposit, buy, sell, dividend. |
| `sandbox.ts` | Creates Sandbox items from those configs plus Plaid's `user_transactions_dynamic` (pending charges that post over time) with the Sandbox-only `/sandbox/public_token/create`. `--sql` writes encrypted items for `reset:dev -- --sandbox`; `--capture <dir>` saves raw responses as test fixtures. |

Sandbox quirks found while building this:
- Only about the last 30 days of a custom user's transactions are returned, so every date sits in the 4 weeks before the latest one; `roll_dates_forward` shifts them to end on the item's creation day.
- A future `date_posted` makes a transaction pending.
- The config is strictly validated: unknown keys (even comments) are rejected.
- Investment `cash` transactions get `dividend` / `deposit` subtypes from a negative quantity on a `CUR:USD` security.

Refresh the committed Sandbox fixtures (fake data, safe to commit):

```bash
cd apps/api && set -a && source .dev.vars && set +a && node --experimental-strip-types --no-warnings seed/sandbox.ts --capture test/fixtures/plaid/sandbox
```
