/**
 * The bank connection flow (§3) as a pure state machine:
 *
 *   intro (trial limit checked)
 *     -> starting (backend creates a Hosted Link session)
 *     -> waiting (Link open in the system browser; we wait for the
 *        financetracker://plaid-complete deep link, and poll meanwhile)
 *     -> finalizing (backend collects the result from Plaid)
 *     -> connected (accounts found)   -> intro again ("Add another bank") or finish
 *     -> duplicate (keep / discard)   -> connected | intro
 *     -> cancelled | failed           -> retry straight away
 *
 * Nothing is saved until the backend's finalize says "done" (or the user
 * keeps a duplicate), so cancelling or failing leaves nothing half-saved.
 * `mode: "update"` is the reconnect flow (Plaid update mode) for one bank.
 */
import type { DuplicateMatch, FinalizeResult, FoundAccount, TrialStatus } from "./api.ts";

export interface ConnectedBank {
  itemId: string;
  institutionName: string | null;
  accounts: FoundAccount[];
  /** Kept although it looked like a bank already connected: matching accounts are hidden. */
  keptDuplicate?: boolean;
}

export type ConnectStep =
  | { step: "intro"; notice?: string }
  | { step: "starting" }
  | { step: "waiting"; sessionId: string; url: string }
  | { step: "finalizing"; sessionId: string; url: string }
  | { step: "duplicate"; sessionId: string; institutionName: string | null; accounts: FoundAccount[]; duplicates: DuplicateMatch[]; resolving: boolean }
  | { step: "connected"; last: ConnectedBank | null; notice?: string }
  | { step: "cancelled"; message: string }
  | { step: "failed"; message: string };

export interface ConnectState {
  mode: "new" | "update";
  /** Update mode: the connection being repaired. */
  itemId?: string;
  institutionName?: string | null;
  limit: TrialStatus | null;
  limitError?: string;
  /** Every bank connected in this run of the flow, in order. */
  banks: ConnectedBank[];
  current: ConnectStep;
}

export type ConnectEvent =
  | { type: "limitLoaded"; limit: TrialStatus }
  | { type: "limitFailed"; error: string }
  | { type: "start" }
  | { type: "sessionCreated"; sessionId: string; url: string }
  | { type: "sessionFailed"; error: string }
  | { type: "finalizeStarted" }
  | { type: "finalized"; result: FinalizeResult }
  | { type: "finalizeFailed"; error: string }
  | { type: "resolveDuplicate" }
  | { type: "duplicateResolved"; result: FinalizeResult }
  | { type: "cancel" }
  | { type: "retry" }
  | { type: "addAnother" };

export function initialConnectState(opts: { mode?: "new" | "update"; itemId?: string; institutionName?: string | null } = {}): ConnectState {
  return { mode: opts.mode ?? "new", itemId: opts.itemId, institutionName: opts.institutionName, limit: null, banks: [], current: { step: "intro" } };
}

/** A friendly reason for a Link/finalize error code. */
export function failureMessage(code: string | null | undefined): string {
  switch (code) {
    case "USER_EXIT":
    case null:
    case undefined:
      return "You closed Plaid before finishing. Nothing was saved.";
    case "LINK_EXPIRED":
      return "The Plaid session expired before it was finished. Nothing was saved.";
    case "DUPLICATE_DISCARDED":
      return "That bank was already connected, so nothing was added.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
      return "The bank isn't responding right now. Nothing was saved; try again in a little while.";
    case "DUPLICATE_DECISION_FAILED":
      return "Couldn't save your choice about the duplicate bank. Nothing was added; try again.";
    case "TRIAL_LIMIT_REACHED":
      return "Plaid's Trial allows 10 bank connections, and they are all used.";
    default:
      return `Plaid reported a problem (${code}). Nothing was saved.`;
  }
}

/** Whether "Connect a bank" may start: not while the Trial limit is reached (new banks only). */
export function canStart(s: ConnectState): boolean {
  if (s.mode === "update") return true;
  return s.limit?.status !== "reached";
}

function bankFromDone(result: Extract<FinalizeResult, { status: "done" }>, keptDuplicate = false): ConnectedBank {
  return { itemId: result.itemId, institutionName: result.institutionName, accounts: result.accounts, ...(keptDuplicate ? { keptDuplicate } : {}) };
}

function afterResult(s: ConnectState, result: FinalizeResult, url: string, fromDuplicate: boolean): ConnectState {
  switch (result.status) {
    case "pending":
    case "finalizing":
      // Not finished in the browser yet: keep waiting (the poll or the deep link will try again).
      return { ...s, current: { step: "waiting", sessionId: result.sessionId, url } };
    case "done": {
      const bank = bankFromDone(result, fromDuplicate);
      // Update mode repairs an existing bank; it isn't a new one in the list.
      const banks = s.mode === "update" ? s.banks : [...s.banks.filter((b) => b.itemId !== bank.itemId), bank];
      return { ...s, banks, current: { step: "connected", last: bank } };
    }
    case "duplicate":
      return {
        ...s,
        current: { step: "duplicate", sessionId: result.sessionId, institutionName: result.institutionName, accounts: result.accounts, duplicates: result.duplicates, resolving: false },
      };
    case "cancelled":
      if (fromDuplicate) return { ...s, current: { step: "connected", last: null, notice: failureMessage(result.errorCode) } };
      return { ...s, current: { step: "cancelled", message: failureMessage(result.errorCode) } };
    case "failed":
      return { ...s, current: { step: "failed", message: failureMessage(result.errorCode) } };
  }
}

export function connectReducer(s: ConnectState, e: ConnectEvent): ConnectState {
  const cur = s.current;
  switch (e.type) {
    case "limitLoaded":
      return { ...s, limit: e.limit, limitError: undefined };
    case "limitFailed":
      return { ...s, limitError: e.error };
    case "start":
    case "retry":
      if (!canStart(s)) return { ...s, current: { step: "intro", notice: failureMessage("TRIAL_LIMIT_REACHED") } };
      if (cur.step === "starting" || cur.step === "waiting" || cur.step === "finalizing" || cur.step === "duplicate") return s;
      return { ...s, current: { step: "starting" } };
    case "sessionCreated":
      return cur.step === "starting" ? { ...s, current: { step: "waiting", sessionId: e.sessionId, url: e.url } } : s;
    case "sessionFailed":
      return cur.step === "starting" ? { ...s, current: { step: "failed", message: e.error } } : s;
    case "finalizeStarted":
      return cur.step === "waiting" ? { ...s, current: { step: "finalizing", sessionId: cur.sessionId, url: cur.url } } : s;
    case "finalized":
      // Ignore late answers for a session the user already left.
      if ((cur.step !== "waiting" && cur.step !== "finalizing") || cur.sessionId !== e.result.sessionId) return s;
      return afterResult(s, e.result, cur.url, false);
    case "finalizeFailed":
      // A network blip while polling: keep waiting; the next poll retries.
      return cur.step === "finalizing" ? { ...s, current: { step: "waiting", sessionId: cur.sessionId, url: cur.url } } : s;
    case "resolveDuplicate":
      return cur.step === "duplicate" ? { ...s, current: { ...cur, resolving: true } } : s;
    case "duplicateResolved":
      if (cur.step !== "duplicate" || cur.sessionId !== e.result.sessionId) return s;
      return afterResult(s, e.result, "", true);
    case "cancel":
      // Leaving the browser step abandons the session; nothing was saved for it.
      if (cur.step === "waiting" || cur.step === "finalizing" || cur.step === "starting") {
        return { ...s, current: { step: "cancelled", message: "Cancelled. Nothing was saved." } };
      }
      return s;
    case "addAnother":
      return { ...s, current: { step: "intro" } };
  }
}

/** The session id a financetracker://plaid-complete?session=… link refers to (null for other links). */
export function sessionFromDeepLink(url: string): string | null {
  const m = /^financetracker:\/\/plaid-complete\/?\?(.*)$/i.exec(url.trim());
  if (!m) return null;
  return new URLSearchParams(m[1]).get("session");
}
