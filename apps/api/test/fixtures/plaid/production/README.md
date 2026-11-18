# Production Plaid fixtures (Phase 4, manual)

Put a few real production responses here, with identifying details removed,
one folder per item, files named like the Sandbox ones (`transactions_sync.json`,
`accounts_get.json`, …: the endpoint path with `/` → `_`).

`test/node/plaid-fixtures.test.ts` picks up every `*.json` in every folder here
automatically, validates it against the same schemas as the Sandbox fixtures
and runs it through the trim functions, so a format difference between
Sandbox and production fails the tests.

## How to anonymise a response

1. Save the raw response body somewhere outside the repo (e.g. `/tmp/raw/transactions_sync.json`).
2. Run the anonymiser from `apps/api`:

   ```bash
   node --experimental-strip-types scripts/anonymise-plaid.ts /tmp/raw/transactions_sync.json test/fixtures/plaid/production/my-bank/transactions_sync.json
   ```

   It keeps the shape and every type the schemas check, and replaces:
   - ids (account, transaction, item, security, request, cursors) with placeholders, the same placeholder wherever an id repeats, so links between transactions survive;
   - names, official names, merchant names, descriptions, tickers and masks with neutral text (`Name 3`, `0000`);
   - owners, addresses, locations, counterparties, payment metadata, URLs and logos with `REDACTED` (coordinates with `0`).

   Amounts, dates, categories, flags and balances are kept. If you don't want real amounts in git either, scale them by hand.
3. **Read the output before committing it.** Anything the anonymiser's key list misses stays as it was.
4. Run `npm test -w @ft/api`.

`test/node/anonymise.test.ts` checks the anonymiser on every Sandbox response.
