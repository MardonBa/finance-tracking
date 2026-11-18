/**
 * Runs the connection state machine (machine.ts) against the backend, the
 * system browser and deep links. Dependencies are injectable for tests.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { connectionsApi, errorMessage, type FinalizeResult, type LinkSession, type TrialStatus } from "./api.ts";
import { connectReducer, initialConnectState, sessionFromDeepLink, type ConnectState } from "./machine.ts";

export const DEEP_LINK_EVENT = "ft:deep-link";

export interface ConnectDeps {
  getLimit(): Promise<TrialStatus>;
  createSession(itemId?: string): Promise<LinkSession>;
  finalize(sessionId: string): Promise<FinalizeResult>;
  resolveDuplicate(sessionId: string, choice: "keep" | "discard"): Promise<FinalizeResult>;
  /** Open Plaid's Hosted Link in the system browser. */
  openUrl(url: string): Promise<void>;
  /** financetracker:// links (the shell forwards them as the `ft:deep-link` window event). */
  onDeepLink(cb: (url: string) => void): () => void;
  /** How often to ask the backend while waiting (the deep link usually arrives first). */
  pollMs: number;
}

/** Opens a URL in the system browser: Tauri's opener plugin, or a new tab in a plain browser (dev). */
export async function openInBrowser(url: string): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function defaultConnectDeps(token: string): ConnectDeps {
  return {
    getLimit: () => connectionsApi.limit(token),
    createSession: (itemId) => connectionsApi.createSession(token, itemId),
    finalize: (id) => connectionsApi.finalize(token, id),
    resolveDuplicate: (id, choice) => connectionsApi.resolveDuplicate(token, id, choice),
    openUrl: openInBrowser,
    onDeepLink: (cb) => {
      const handler = (e: Event) => cb(String((e as CustomEvent<string>).detail));
      window.addEventListener(DEEP_LINK_EVENT, handler);
      return () => window.removeEventListener(DEEP_LINK_EVENT, handler);
    },
    pollMs: 3000,
  };
}

export interface ConnectFlow {
  state: ConnectState;
  start(): void;
  retry(): void;
  cancel(): void;
  addAnother(): void;
  resolveDuplicate(choice: "keep" | "discard"): void;
  /** Re-open the Plaid page (e.g. the browser tab was closed by mistake). */
  reopen(): void;
}

export function useConnectFlow(deps: ConnectDeps, opts: { mode?: "new" | "update"; itemId?: string; institutionName?: string | null } = {}): ConnectFlow {
  const [state, dispatch] = useReducer(connectReducer, opts, initialConnectState);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Trial limit (new banks only), checked before the user starts (§3).
  const limitTick = state.banks.length;
  useEffect(() => {
    if (state.mode === "update") return;
    let live = true;
    depsRef.current.getLimit().then(
      (limit) => live && dispatch({ type: "limitLoaded", limit }),
      (e) => live && dispatch({ type: "limitFailed", error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [state.mode, limitTick]);

  // starting: create the session, then open it in the system browser.
  const step = state.current.step;
  useEffect(() => {
    if (step !== "starting") return;
    let live = true;
    depsRef.current.createSession(stateRef.current.itemId).then(
      (session) => {
        if (!live) return;
        dispatch({ type: "sessionCreated", sessionId: session.sessionId, url: session.hostedLinkUrl });
        void depsRef.current.openUrl(session.hostedLinkUrl).catch(() => undefined);
      },
      (e) => live && dispatch({ type: "sessionFailed", error: errorMessage(e, "Couldn't start Plaid. Nothing was saved.") }),
    );
    return () => {
      live = false;
    };
  }, [step]);

  // waiting: finalize on the deep link, and poll in case it never arrives (e.g. the browser didn't hand off).
  const sessionId = state.current.step === "waiting" || state.current.step === "finalizing" ? state.current.sessionId : null;
  const inFlight = useRef(false);
  const tryFinalize = useCallback((id: string) => {
    if (inFlight.current) return;
    const cur = stateRef.current.current;
    if (cur.step !== "waiting" || cur.sessionId !== id) return;
    inFlight.current = true;
    dispatch({ type: "finalizeStarted" });
    depsRef.current
      .finalize(id)
      .then(
        (result) => dispatch({ type: "finalized", result }),
        (e) => dispatch({ type: "finalizeFailed", error: errorMessage(e) }),
      )
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const off = depsRef.current.onDeepLink((url) => {
      const linked = sessionFromDeepLink(url);
      // A bare plaid-complete link (no session) also means "check now".
      if (linked === sessionId || (linked === null && /^financetracker:\/\/plaid-complete/i.test(url))) tryFinalize(sessionId);
    });
    const timer = setInterval(() => tryFinalize(sessionId), depsRef.current.pollMs);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [sessionId, tryFinalize]);

  const resolveDuplicate = useCallback((choice: "keep" | "discard") => {
    const cur = stateRef.current.current;
    if (cur.step !== "duplicate" || cur.resolving) return;
    dispatch({ type: "resolveDuplicate" });
    depsRef.current.resolveDuplicate(cur.sessionId, choice).then(
      (result) => dispatch({ type: "duplicateResolved", result }),
      () => dispatch({ type: "duplicateResolved", result: { status: "failed", sessionId: cur.sessionId, errorCode: "DUPLICATE_DECISION_FAILED" } }),
    );
  }, []);

  // Stable callbacks: safe to use as effect dependencies (e.g. "start right away").
  const callbacks = useMemo(
    () => ({
      start: () => dispatch({ type: "start" }),
      retry: () => dispatch({ type: "retry" }),
      cancel: () => dispatch({ type: "cancel" }),
      addAnother: () => dispatch({ type: "addAnother" }),
      reopen: () => {
        const cur = stateRef.current.current;
        if (cur.step === "waiting" || cur.step === "finalizing") void depsRef.current.openUrl(cur.url).catch(() => undefined);
      },
    }),
    [],
  );
  return useMemo(() => ({ state, resolveDuplicate, ...callbacks }), [state, resolveDuplicate, callbacks]);
}
