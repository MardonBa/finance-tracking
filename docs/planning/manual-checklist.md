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
- [ ] Webhooks from Plaid: deploy the dev Worker, set `PUBLIC_API_URL` to its https URL, fire a Sandbox webhook → verified and synced (command in the spike doc).
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
