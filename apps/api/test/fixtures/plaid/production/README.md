# Production Plaid fixtures (Phase 4, manual)

Put a few real production responses here, with identifying details removed
(names, masks, merchant names you don't want in git, ids), one folder per
item, files named like the Sandbox ones (`transactions_sync.json`,
`accounts_get.json`, …: the endpoint path with `/` → `_`).

`test/node/plaid-fixtures.test.ts` validates every file here against the same
schemas as the Sandbox fixtures and runs them through the trim functions, so
a format difference between Sandbox and production fails the tests.
