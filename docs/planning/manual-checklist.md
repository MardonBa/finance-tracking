# Manual checklist

Steps only you can do: real Touch ID, browser sign-in, real banks, production. Each track adds its steps here. Tick them off when done; the goal stays open until they are.

## Sign-in, Touch ID, deep links (shell track)
- [ ] `npm run dev` with an empty Keychain → "Sign in with Google" → finish in the browser → the app returns to "Set up Touch ID".
- [ ] Sign in with a different Google account → refused, nothing created.
- [ ] Touch ID prompt: cancel once (error + retry), then succeed → the desktop opens.
- [ ] Quit and relaunch → Touch ID is asked before anything shows; try the Mac-password fallback too.
- [ ] Relock: set `RELOCK_AFTER_SECS` in `apps/desktop/src-tauri/src/relock.rs` to ~60 temporarily → the app locks.
- [ ] Revoke: `POST /auth/revoke` → the next request sends you back to Google sign-in.
- [ ] Deep link: `tauri build`, then `open "financetracker://test"` → the app comes to the front (deep links don't register under `tauri dev`).
- [ ] In the real app: ⌘W closes only the in-app window, ⌘` cycles windows, and drag/resize stay smooth with charts.
- [ ] Look over the orange/pink shades at `#styleguide` in a dev build.

## Bank connections, webhooks, backups (backend track)
- [ ] Hosted Link in a browser (Sandbox): First Platypus with `user_good`/`pass_good`, then Platypus OAuth Bank, then cancel partway → nothing saved. Steps: `docs/planning/plaid-hosted-link-spike.md`.
- [x] Webhooks from Plaid: done 2026-11-18 by the orchestrator. Dev Worker deployed at `https://ft-api-dev.ft-api.workers.dev` (`npm run deploy:dev -w @ft/api`); connecting a Sandbox bank made Plaid send 4 real webhooks to `/plaid/webhook`, all answered 200 (unverified requests get 401), seen with `wrangler tail`.
- [ ] Optionally add `ALLOWED_GOOGLE_SUB` to `.env` (email is already set).
- [ ] Restore one backup into a fresh remote database (`docs/backup-restore.md`).
- [ ] Production: set `PUBLIC_API_URL` and all production secrets (`PLAID_SECRET`, `TOKEN_ENC_KEY`, `BACKUP_ENC_KEY`, `APP_TOKEN_PEPPER`).
- [ ] Real Chase: finish Chase's OAuth registration in the Plaid dashboard.

## Budgets & goals

- [ ] In the Tauri app (`npm run dev`), add a goal picture: it is saved under the app data dir (`~/Library/Application Support/<bundle id>/goal-pictures/`) and still shows after a restart. Delete that folder: the card shows the placeholder and "Add picture".
- [ ] Turn on System Settings → Accessibility → Display → Reduce motion, cross a goal milestone, open Goals: the celebration fades in with no confetti.
- [ ] Drag goal priorities with a trackpad: the card lifts, the others slide, the blue drop line shows, and the projected dates change while dragging. Then do the same with Tab + arrow keys and VoiceOver on (it announces "moved to priority N").
- [ ] Each celebration plays once: cross a milestone, open Goals (it plays), close and reopen Goals and the Overview (it doesn't play again).
- [ ] Click a budget bar, a pending extension, a trip month and a history cell: the Transactions window lists exactly the transactions and its total matches the number clicked (needs the transactions-spending window merged).
## Transactions & spending
- [ ] With real data: click a few Sankey flows, category bars, heatmap days and top-merchant totals in Spending and check the Transactions total matches what you clicked and the transactions look right.
- [ ] Check that merchant grouping looks sensible on your real merchants; try one merge and one separate, then Undo.
- [ ] Label your main categories and merchants as necessary / not necessary (Spending → Necessary?) and see that the "not set" amount shrinks.
- [ ] Glance at the Spending window at its default size: the summary and flow should be readable without scrolling, everything else behind tabs.
- [ ] Contrast check of the heatmap shades and Sankey labels with a contrast tool.

## Recurring, trajectory & investments
- [ ] Recurring: with a real bank connected, the upcoming view for your checking account lists the bills and card statement you expect before your next paycheck, and the lowest point looks right.
- [ ] Recurring: add a large test charge so checking would go below zero → the red warning appears at the top (account, how much short, date); remove it again → the warning goes.
- [ ] Recurring: a bill you know varies (e.g. utilities) is marked "Estimate"; a subscription whose price changed shows "Was $X, now $Y" quietly.
- [ ] Trajectory: hover the net worth chart → date, each account and the total; "By type" groups them; estimated (rebuilt) history is shaded once the balance rebuild runs on real data.
- [ ] Trajectory: change an assumption → the projection moves right away; Save → it's still there after reopening the window. Try a life phase and check the "assumed to stay the same" years.
- [ ] Trajectory: earning vs spending numbers match what you'd expect for a couple of months; clicking one opens its transactions (once the Transactions window is merged).
- [ ] Investments: holdings and values match your brokerage; performance's "put in" matches your own record of transfers since connecting.
- [ ] Investments: add a note to a dividend and see it after a sync (the sync must not wipe it).

## Onboarding & overview
- [ ] First run in the real app: after "Set up Touch ID", the "Add your banks" step opens. Check "Skip for now" lands on the desktop with no banks.
- [ ] Connect a bank (Sandbox First Platypus, `user_good` / `pass_good`): Plaid opens in Safari/your default browser, the app comes forward on `financetracker://plaid-complete`, and the accounts found are listed. Rename one, hide one, change a type, Save → the before → after card → the Overview shows it.
- [ ] Platypus OAuth Bank: same, through the bank's OAuth page.
- [ ] Close the Plaid tab halfway → "Cancel" in the app → "Nothing was saved" → "Try again" opens a fresh Plaid session.
- [ ] Connect the same bank twice → the duplicate warning; try both "Discard" and "Keep" (matching accounts hidden).
- [ ] While a new bank imports, its row says "Importing transactions…" and turns into "Up to date" without reopening anything.
- [ ] `/sandbox/item/reset_login` on a connected item (dev route `POST /dev/sandbox/reset-login`), quit and relaunch → right after Touch ID, the prompt names the bank and "Needs you to sign in again"; Reconnect → Plaid update mode in the browser → back in the app, the bank is fixed and history kept. Dismiss it once instead → the accounts show "Out of date · …" and net worth says it includes out-of-date accounts.
- [ ] Refresh on the Overview: progress, then "Up to date" or the bank's error with Reconnect.
- [ ] Overview at its default size on your screen: everything visible without scrolling; the alerts strip only shows when something needs dealing with.
- [ ] Each Overview element opens the right place: spending → Spending / its transactions, a transaction → Transactions, budget → Budgets, goal → Goals, net worth → Trajectory, an account → its details.
- [ ] Add account → Manual account "Wallet" with $40 → add, edit, delete a transaction with a category and note; the balance and net worth follow.
- [ ] Dock → Security: your credentials are listed; "Sign out this Mac" (confirm) sends you back to Google sign-in. Try "Revoke all" only when you mean it.

## Production go-live (orchestrator, Phase 4)
Production D1 `ft-prod` and R2 `ft-backups-prod` were created on 2026-11-18 and are in `apps/api/wrangler.toml`. The production migration was left for you (the tool permission check blocked it overnight).
- [ ] Apply migrations: `cd apps/api && npx wrangler d1 migrations apply DB --remote --env production`.
- [ ] Set production secrets with `npx wrangler secret put <NAME> --env production` (see `docs/shipping.md`): `PLAID_CLIENT_ID`, production `PLAID_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `ALLOWED_GOOGLE_EMAIL`, and fresh `TOKEN_ENC_KEY`, `BACKUP_ENC_KEY`, `APP_TOKEN_PEPPER`. Keep a copy of `BACKUP_ENC_KEY` somewhere safe outside Cloudflare, or backups can't be restored.
- [ ] Deploy: `cd apps/api && npx wrangler deploy --env production`, then check `https://ft-api.ft-api.workers.dev/health`.
- [ ] Build the app against production: `cd apps/desktop && VITE_API_URL=https://ft-api.ft-api.workers.dev npm run tauri build`, then copy it to `/Applications`.
- [ ] Connect a real bank, then save 2–3 anonymised production Plaid responses into `apps/api/test/fixtures/plaid/production/` (see its README) and run `npm test`.
