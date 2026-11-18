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
