import { describe, expect, it } from "vitest";
import { gateReducer, SESSION_ENDED, type GateEvent, type GateState } from "./gate.ts";

const run = (events: GateEvent[], steps = 0, start: GateState = { kind: "starting" }) => events.reduce((s, e) => gateReducer(s, e, steps), start);

describe("app gate", () => {
  it("first run: Google sign-in, then one Touch ID, then the desktop", () => {
    const s0 = run([{ type: "started", hasCredential: false }]);
    expect(s0.kind).toBe("signIn");
    const s1 = run([{ type: "started", hasCredential: false }, { type: "signInStart" }]);
    expect(s1).toEqual({ kind: "signIn", busy: true });
    const s2 = run([{ type: "started", hasCredential: false }, { type: "signInStart" }, { type: "signInDone" }]);
    expect(s2.kind).toBe("setupTouchId");
    const s3 = gateReducer(s2, { type: "touchIdDone", token: "tok" });
    expect(s3).toEqual({ kind: "ready", token: "tok" });
  });

  it("first run runs the Phase 2 onboarding steps (add banks) before the desktop", () => {
    let s = run([{ type: "started", hasCredential: false }, { type: "signInDone" }, { type: "touchIdDone", token: "tok" }], 2);
    expect(s).toEqual({ kind: "onboarding", token: "tok", step: 0 });
    s = gateReducer(s, { type: "onboardingNext", stepCount: 2 });
    expect(s).toMatchObject({ kind: "onboarding", step: 1 });
    s = gateReducer(s, { type: "onboardingNext", stepCount: 2 });
    expect(s).toEqual({ kind: "ready", token: "tok" });
  });

  it("returning: Touch ID first, nothing before success", () => {
    const locked = run([{ type: "started", hasCredential: true }]);
    expect(locked.kind).toBe("locked");
    const failed = run([{ type: "touchIdStart" }, { type: "touchIdFailed", error: "Cancelled" }], 0, locked);
    expect(failed).toEqual({ kind: "locked", busy: false, error: "Cancelled" });
    expect(gateReducer(failed, { type: "touchIdDone", token: "tok" }, 3)).toEqual({ kind: "ready", token: "tok" });
  });

  it("returning users skip onboarding", () => {
    expect(run([{ type: "started", hasCredential: true }, { type: "touchIdDone", token: "t" }], 2)).toEqual({ kind: "ready", token: "t" });
  });

  it("a missing credential after Touch ID goes back to Google sign-in", () => {
    expect(run([{ type: "started", hasCredential: true }, { type: "touchIdDone", token: null }])).toEqual({ kind: "signIn", busy: false, notice: SESSION_ENDED });
  });

  it("72h relock returns to the lock screen", () => {
    expect(gateReducer({ kind: "ready", token: "t" }, { type: "relocked" })).toEqual({ kind: "locked", busy: false });
  });

  it("an API 401 goes back to Google sign-in", () => {
    expect(gateReducer({ kind: "ready", token: "t" }, { type: "unauthorized" })).toEqual({ kind: "signIn", busy: false, notice: SESSION_ENDED });
  });

  it("sign-in failure shows the error and allows retry", () => {
    const s = run([{ type: "started", hasCredential: false }, { type: "signInStart" }, { type: "signInFailed", error: "This Google account isn't allowed" }]);
    expect(s).toEqual({ kind: "signIn", busy: false, error: "This Google account isn't allowed" });
    expect(gateReducer(s, { type: "signInStart" })).toEqual({ kind: "signIn", busy: true });
  });

  it("ignores out-of-place events", () => {
    const ready: GateState = { kind: "ready", token: "t" };
    expect(gateReducer(ready, { type: "touchIdDone", token: "x" })).toBe(ready);
    expect(gateReducer(ready, { type: "signInDone" })).toBe(ready);
    const signIn: GateState = { kind: "signIn", busy: false };
    expect(gateReducer(signIn, { type: "relocked" })).toBe(signIn);
  });

  it("the dev bypass goes straight to ready", () => {
    expect(gateReducer({ kind: "starting" }, { type: "devBypass", token: "dev" })).toEqual({ kind: "ready", token: "dev" });
  });
});
