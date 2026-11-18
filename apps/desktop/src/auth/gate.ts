/**
 * The app gate as a pure state machine (§2, §3):
 *
 *   no credential  -> signIn (Google) -> setupTouchId (one authenticate)
 *                  -> onboarding steps (Phase 2: add banks) -> ready
 *   credential     -> locked (Touch ID first) -> ready
 *   ready + 72h relock      -> locked
 *   any API 401 / revoked   -> signIn
 *
 * Nothing that loads data renders before `ready`.
 */

export type GateState =
  | { kind: "starting" }
  | { kind: "unsupported" }
  | { kind: "signIn"; busy: boolean; error?: string; notice?: string }
  | { kind: "setupTouchId"; busy: boolean; error?: string }
  | { kind: "locked"; busy: boolean; error?: string }
  | { kind: "onboarding"; token: string; step: number }
  | { kind: "ready"; token: string };

export type GateEvent =
  | { type: "started"; hasCredential: boolean }
  | { type: "unsupported" }
  | { type: "devBypass"; token: string }
  | { type: "signInStart" }
  | { type: "signInDone" }
  | { type: "signInFailed"; error: string }
  | { type: "touchIdStart" }
  | { type: "touchIdDone"; token: string | null }
  | { type: "touchIdFailed"; error: string }
  | { type: "onboardingNext"; stepCount: number }
  | { type: "relocked" }
  | { type: "unauthorized" };

export const SESSION_ENDED = "Your session ended. Sign in with Google again.";

export function gateReducer(state: GateState, event: GateEvent, onboardingSteps = 0): GateState {
  switch (event.type) {
    case "started":
      return event.hasCredential ? { kind: "locked", busy: false } : { kind: "signIn", busy: false };
    case "unsupported":
      return { kind: "unsupported" };
    case "devBypass":
      return { kind: "ready", token: event.token };
    case "signInStart":
      return state.kind === "signIn" ? { kind: "signIn", busy: true } : state;
    case "signInDone":
      return state.kind === "signIn" ? { kind: "setupTouchId", busy: false } : state;
    case "signInFailed":
      return state.kind === "signIn" ? { kind: "signIn", busy: false, error: event.error } : state;
    case "touchIdStart":
      return state.kind === "setupTouchId" || state.kind === "locked" ? { ...state, busy: true, error: undefined } : state;
    case "touchIdFailed":
      return state.kind === "setupTouchId" || state.kind === "locked" ? { ...state, busy: false, error: event.error } : state;
    case "touchIdDone":
      if (state.kind !== "setupTouchId" && state.kind !== "locked") return state;
      // The credential vanished (deleted in Keychain Access, say): sign in again.
      if (!event.token) return { kind: "signIn", busy: false, notice: SESSION_ENDED };
      if (state.kind === "setupTouchId" && onboardingSteps > 0) return { kind: "onboarding", token: event.token, step: 0 };
      return { kind: "ready", token: event.token };
    case "onboardingNext":
      if (state.kind !== "onboarding") return state;
      return state.step + 1 < event.stepCount ? { ...state, step: state.step + 1 } : { kind: "ready", token: state.token };
    case "relocked":
      return state.kind === "ready" || state.kind === "onboarding" ? { kind: "locked", busy: false } : state;
    case "unauthorized":
      return state.kind === "ready" || state.kind === "onboarding" || state.kind === "locked"
        ? { kind: "signIn", busy: false, notice: SESSION_ENDED }
        : state;
  }
}
