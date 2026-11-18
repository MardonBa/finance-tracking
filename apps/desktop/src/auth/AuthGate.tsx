/**
 * App gate (§2, §3): Google sign-in -> Touch ID setup -> (Phase 2 steps) ->
 * desktop on first run; Touch ID first on every later launch and after the
 * 72h relock; back to Google sign-in on any 401. The Shell (and so every
 * data request) only mounts in the `ready` state.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { API_URL, DEV_APP_TOKEN, setUnauthorizedHandler } from "../api/client.ts";
import { errorText, isTauri, native } from "../native/bridge.ts";
import { Shell } from "../shell/Shell.tsx";
import { Button, Card, EmptyState } from "../ui/components.tsx";
import { gateReducer, type GateEvent, type GateState } from "./gate.ts";
import { LockScreen } from "./LockScreen.tsx";
import { ADD_BANKS_STEP_ID, ONBOARDING_STEPS } from "./onboarding.ts";

const UNLOCK_REASON = "unlock Finance Tracker";
const SETUP_REASON = "set up Touch ID for Finance Tracker";

const reducer = (s: GateState, e: GateEvent) => gateReducer(s, e, ONBOARDING_STEPS.length);

export function AuthGate() {
  const [state, dispatch] = useReducer(reducer, { kind: "starting" });
  const [addingBanks, setAddingBanks] = useState(false);

  // Start: dev bypass, unsupported (plain browser), or check the Keychain.
  useEffect(() => {
    if (DEV_APP_TOKEN) {
      dispatch({ type: "devBypass", token: DEV_APP_TOKEN });
      return;
    }
    if (!isTauri()) {
      dispatch({ type: "unsupported" });
      return;
    }
    native
      .hasCredential()
      .then((has) => dispatch({ type: "started", hasCredential: has }))
      .catch(() => dispatch({ type: "started", hasCredential: false }));
  }, []);

  // 72h relock and API 401s.
  useEffect(() => {
    if (!isTauri() || DEV_APP_TOKEN) return;
    const off = native.onLocked(() => dispatch({ type: "relocked" }));
    return () => void off.then((f) => f());
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (DEV_APP_TOKEN) return;
      void native.signOut().catch(() => undefined);
      dispatch({ type: "unauthorized" });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // financetracker:// links (Plaid Hosted Link returns, §3) go to whoever listens for "ft:deep-link".
  useEffect(() => {
    if (!isTauri()) return;
    const forward = (urls: string[]) => urls.forEach((url) => window.dispatchEvent(new CustomEvent("ft:deep-link", { detail: url })));
    const off = native.onDeepLink(forward);
    void native.takeDeepLinks().then(forward).catch(() => undefined);
    return () => void off.then((f) => f());
  }, []);

  // One Touch ID prompt at a time (StrictMode runs effects twice in dev).
  const prompting = useRef(false);
  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    dispatch({ type: "touchIdStart" });
    try {
      const token = await native.unlock(state.kind === "setupTouchId" ? SETUP_REASON : UNLOCK_REASON);
      dispatch({ type: "touchIdDone", token });
    } catch (e) {
      dispatch({ type: "touchIdFailed", error: errorText(e) });
    } finally {
      prompting.current = false;
    }
  }, [state.kind]);

  // Entering the locked state asks for Touch ID right away (the button retries).
  const lockedNow = state.kind === "locked";
  useEffect(() => {
    if (lockedNow) void unlock();
  }, [lockedNow, unlock]);

  const signIn = async () => {
    dispatch({ type: "signInStart" });
    try {
      await native.signInWithGoogle(API_URL);
      dispatch({ type: "signInDone" });
    } catch (e) {
      dispatch({ type: "signInFailed", error: errorText(e) });
    }
  };

  switch (state.kind) {
    case "starting":
      return <LockScreen title="Finance Tracker" />;
    case "unsupported":
      return (
        <LockScreen title="Open the desktop app">
          <p className="gate-text">
            Sign-in and Touch ID need the Finance Tracker app. Run <code>npm run dev</code> from the repo root.
          </p>
        </LockScreen>
      );
    case "signIn":
      return (
        <LockScreen title="Sign in" step="Step 1 of 2" error={state.error} notice={state.notice}>
          <p className="gate-text">Sign in with your Google account. It opens in your browser and comes back here.</p>
          <Button variant="primary" size="lg" onClick={signIn} disabled={state.busy}>
            {state.busy ? "Waiting for the browser…" : "Sign in with Google"}
          </Button>
        </LockScreen>
      );
    case "setupTouchId":
      return (
        <LockScreen title="Set up Touch ID" step="Step 2 of 2" error={state.error}>
          <p className="gate-text">From now on, opening the app uses Touch ID (or your Mac password) instead of Google.</p>
          <Button variant="primary" size="lg" icon="fingerprint" onClick={unlock} disabled={state.busy}>
            {state.busy ? "Waiting for Touch ID…" : "Set up Touch ID"}
          </Button>
        </LockScreen>
      );
    case "locked":
      return (
        <LockScreen title="Finance Tracker is locked" error={state.error}>
          <Button variant="primary" size="lg" icon="fingerprint" onClick={unlock} disabled={state.busy}>
            {state.busy ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
          </Button>
        </LockScreen>
      );
    case "onboarding": {
      const step = ONBOARDING_STEPS[state.step];
      if (!step) return null;
      const Step = step.component;
      return (
        <LockScreen wide>
          <Step token={state.token} done={() => dispatch({ type: "onboardingNext", stepCount: ONBOARDING_STEPS.length })} />
        </LockScreen>
      );
    }
    case "ready": {
      const addBanks = ONBOARDING_STEPS.find((s) => s.id === ADD_BANKS_STEP_ID);
      return (
        <>
          <Shell token={state.token} onAddBanks={() => setAddingBanks(true)} />
          {addingBanks && (
            <div className="gate-overlay" role="dialog" aria-modal="true" aria-label="Add a bank">
              {addBanks ? (
                <addBanks.component token={state.token} done={() => setAddingBanks(false)} />
              ) : (
                // TODO(revisit): placeholder until Phase 2 registers the "add-banks" onboarding step.
                <Card>
                  <EmptyState
                    icon="plus"
                    title="Bank connections aren't set up yet"
                    description="Adding banks through Plaid arrives with the onboarding flow."
                    action={{ label: "Close", onClick: () => setAddingBanks(false) }}
                  />
                </Card>
              )}
            </div>
          )}
        </>
      );
    }
  }
}
