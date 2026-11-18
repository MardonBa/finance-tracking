# Open items

Defaults and placeholders chosen while building autonomously. Each has a matching `TODO(revisit):` in the code. Confirm or change them, then delete the line.

## Phase 0 (foundation)

- **User time zone:** `USER_TIME_ZONE = "America/New_York"` in `apps/api/wrangler.toml` (dev and production). It decides "today" for queries and the cron. Set it to the real zone.
- **Daily sync time:** cron `0 11 * * *` (11:00 UTC) in `apps/api/wrangler.toml`; success-criteria §4 leaves this open.
- **Production Cloudflare resources:** the D1 id (`00000000-…`) and the R2 bucket `ft-backups-prod` in `apps/api/wrangler.toml` are placeholders. Create them in Phase 4 (`docs/shipping.md`).
- **Production secrets:** never set yet. In particular the production `PLAID_SECRET`, and fresh `TOKEN_ENC_KEY` / `BACKUP_ENC_KEY` / `APP_TOKEN_PEPPER` via `wrangler secret put --env production`.
- **`ALLOWED_GOOGLE_SUB` / `ALLOWED_GOOGLE_EMAIL`:** empty in `.env`; the backend track needs one of them to restrict sign-in to the user's account.
- **Orange and pink shades:** proposed values in `apps/desktop/src/ui/tokens.css` (§15 Open); they still need a WCAG AA contrast check.
- **Plaid webhook:** `/plaid/webhook` returns 501 until the backend track adds signature verification.
- **`scheduled()`:** a stub that does nothing yet (backend track).
- **Sandbox limits:** custom users only return about the last 30 days and can't simulate a pending charge posting. That case is covered by `user_transactions_dynamic` and the deterministic seed (`apps/api/seed/README.md`).
- **Dev auth:** the desktop app uses `DEV_APP_TOKEN` (dev builds only) until Google sign-in issues real app tokens.
- **Undo conflicts:** undoing an older action restores rows as they were before it, even if a later action changed the same rows. There is no conflict detection yet (`apps/api/src/routes/registry.ts`).

## Phase 1: shell

- **Orange and pink shades (follow-up to the Phase 0 item):** settled for now in `apps/desktop/src/ui/tokens.css` and checked by `src/ui/contrast.test.ts`. Text shades `--orange-700 #9a4416` / `--pink-700 #a03158` pass 4.5:1 on every cream; chart shades `--orange-600 #c2601f` / `--pink-600 #c74a78` pass 3:1. The 500/300/100 shades are fills only. Confirm the look in the styleguide (`#styleguide` in a dev build).
- **Keychain access control:** the credential item has no user-presence ACL (that needs a signed app with a keychain-access-groups entitlement). Reads are gated in Rust: `get_credential` refuses unless Touch ID unlocked the session (`src-tauri/src/native.rs`).
- **Google client secret in the binary:** baked in at build time from `.env` for the Desktop OAuth client, which Google treats as non-confidential; PKCE protects the code (`src-tauri/src/oauth.rs`).
- **Sign-in timeout:** the loopback listener waits 5 minutes for the browser (`src-tauri/src/oauth.rs`).
- **Relock granularity:** the 72h check runs every 30 s, so the relock can fire up to 30 s late (`src-tauri/src/relock.rs`).
- **Deep links under `tauri dev`:** macOS only registers `financetracker://` for a bundled app; test deep links with `tauri build` (`src-tauri/src/lib.rs`).
- **Window sizes after the app window shrinks:** windows shrink to fit and stay that size when the app window grows again (`src/shell/wm/state.ts`).
- **Category colours:** 6 named colours, categories under 2% of the total share "Other" (`src/ui/colorMap.ts`).
- **Dev auth bypass:** `VITE_DEV_AUTH_BYPASS=1` must be passed on the command line; `sync-dev-vars` doesn't write it (`src/api/client.ts`).
- **"Add a bank" before Phase 2:** shows a placeholder dialog until the onboarding track registers the `add-banks` step (`src/auth/AuthGate.tsx`).
