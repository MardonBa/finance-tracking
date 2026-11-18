/** The bank connection flow's state machine (§3): success, cancel, failure, duplicate, Trial limit. */
import { describe, expect, it } from "vitest";
import { canStart, connectReducer, initialConnectState, sessionFromDeepLink, type ConnectEvent, type ConnectState } from "./machine.ts";
import type { FinalizeResult } from "./api.ts";

const run = (events: ConnectEvent[], s: ConnectState = initialConnectState()) => events.reduce(connectReducer, s);
const opened: ConnectEvent[] = [{ type: "start" }, { type: "sessionCreated", sessionId: "ls_1", url: "https://secure.plaid.com/hl/x" }];
const account = { id: "acc_1", name: "Checking", mask: "0001", type: "depository", subtype: "checking", currentBalanceCents: 100, hidden: false };
const done: FinalizeResult = { status: "done", sessionId: "ls_1", itemId: "item_1", institutionName: "First Platypus", accounts: [account] };

describe("connectReducer", () => {
  it("success: intro → starting → waiting → finalizing → connected, with the bank's accounts", () => {
    let s = run([{ type: "start" }]);
    expect(s.current.step).toBe("starting");
    s = run([{ type: "sessionCreated", sessionId: "ls_1", url: "u" }], s);
    expect(s.current).toEqual({ step: "waiting", sessionId: "ls_1", url: "u" });
    s = run([{ type: "finalizeStarted" }], s);
    expect(s.current.step).toBe("finalizing");
    s = run([{ type: "finalized", result: { ...done } }], s);
    expect(s.current).toMatchObject({ step: "connected", last: { itemId: "item_1", accounts: [account] } });
    expect(s.banks).toHaveLength(1);
  });

  it("pending results keep waiting; another bank can be added after; banks accumulate", () => {
    let s = run([...opened, { type: "finalizeStarted" }, { type: "finalized", result: { status: "pending", sessionId: "ls_1" } }]);
    expect(s.current.step).toBe("waiting");
    s = run([{ type: "finalizeStarted" }, { type: "finalized", result: done }, { type: "addAnother" }], s);
    expect(s.current.step).toBe("intro");
    s = run(
      [
        { type: "start" },
        { type: "sessionCreated", sessionId: "ls_2", url: "u2" },
        { type: "finalizeStarted" },
        { type: "finalized", result: { ...done, sessionId: "ls_2", itemId: "item_2" } },
      ],
      s,
    );
    expect(s.banks.map((b) => b.itemId)).toEqual(["item_1", "item_2"]);
  });

  it("cancel: leaving the browser step saves nothing and allows an immediate retry", () => {
    let s = run([...opened, { type: "cancel" }]);
    expect(s.current).toMatchObject({ step: "cancelled", message: expect.stringContaining("Nothing was saved") });
    expect(s.banks).toEqual([]);
    // A late finalize answer for the abandoned session is ignored.
    s = run([{ type: "finalized", result: done }], s);
    expect(s.current.step).toBe("cancelled");
    s = run([{ type: "retry" }], s);
    expect(s.current.step).toBe("starting");
  });

  it("Plaid reports the user exited: cancelled; a Link error: failed; both retry straight away", () => {
    const cancelled = run([...opened, { type: "finalizeStarted" }, { type: "finalized", result: { status: "cancelled", sessionId: "ls_1", errorCode: "USER_EXIT" } }]);
    expect(cancelled.current).toMatchObject({ step: "cancelled", message: expect.stringContaining("closed Plaid") });
    const failed = run([...opened, { type: "finalizeStarted" }, { type: "finalized", result: { status: "failed", sessionId: "ls_1", errorCode: "INSTITUTION_DOWN" } }]);
    expect(failed.current).toMatchObject({ step: "failed", message: expect.stringContaining("Nothing was saved") });
    expect(failed.banks).toEqual([]);
    expect(run([{ type: "retry" }], failed).current.step).toBe("starting");
    // Creating the session itself failing is a failure too.
    expect(run([{ type: "start" }, { type: "sessionFailed", error: "Plaid is down" }]).current).toEqual({ step: "failed", message: "Plaid is down" });
  });

  it("a network error while polling keeps waiting", () => {
    const s = run([...opened, { type: "finalizeStarted" }, { type: "finalizeFailed", error: "offline" }]);
    expect(s.current.step).toBe("waiting");
  });

  it("duplicate: warns, then keep adds the bank (marked) and discard adds nothing", () => {
    const dup: FinalizeResult = {
      status: "duplicate",
      sessionId: "ls_1",
      institutionName: "First Platypus",
      accounts: [{ ...account, id: null }],
      duplicates: [{ existingItemId: "item_0", existingInstitutionName: "First Platypus", sameInstitution: true, matchingAccounts: [] }],
    };
    const warned = run([...opened, { type: "finalizeStarted" }, { type: "finalized", result: dup }]);
    expect(warned.current).toMatchObject({ step: "duplicate", resolving: false });
    const resolving = run([{ type: "resolveDuplicate" }], warned);
    expect(resolving.current).toMatchObject({ step: "duplicate", resolving: true });

    const kept = run([{ type: "duplicateResolved", result: done }], resolving);
    expect(kept.current).toMatchObject({ step: "connected", last: { itemId: "item_1", keptDuplicate: true } });
    expect(kept.banks).toHaveLength(1);

    const discarded = run([{ type: "duplicateResolved", result: { status: "cancelled", sessionId: "ls_1", errorCode: "DUPLICATE_DISCARDED" } }], resolving);
    expect(discarded.current).toMatchObject({ step: "connected", last: null, notice: expect.stringContaining("already connected") });
    expect(discarded.banks).toEqual([]);
  });

  it("Trial limit: close still starts; reached blocks new banks (not reconnects)", () => {
    const close = run([{ type: "limitLoaded", limit: { count: 8, limit: 10, remaining: 2, status: "close" } }]);
    expect(canStart(close)).toBe(true);
    expect(run([{ type: "start" }], close).current.step).toBe("starting");

    const reached = run([{ type: "limitLoaded", limit: { count: 10, limit: 10, remaining: 0, status: "reached" } }]);
    expect(canStart(reached)).toBe(false);
    expect(run([{ type: "start" }], reached).current).toMatchObject({ step: "intro", notice: expect.stringContaining("10 bank connections") });

    const update = run([{ type: "limitLoaded", limit: { count: 10, limit: 10, remaining: 0, status: "reached" } }], initialConnectState({ mode: "update", itemId: "item_1" }));
    expect(canStart(update)).toBe(true);
  });

  it("update mode (reconnect): done repairs, without adding a bank", () => {
    const s = run([...opened, { type: "finalizeStarted" }, { type: "finalized", result: done }], initialConnectState({ mode: "update", itemId: "item_1" }));
    expect(s.current.step).toBe("connected");
    expect(s.banks).toEqual([]);
  });
});

describe("sessionFromDeepLink", () => {
  it("reads the session from financetracker://plaid-complete links only", () => {
    expect(sessionFromDeepLink("financetracker://plaid-complete?session=ls_abc")).toBe("ls_abc");
    expect(sessionFromDeepLink("financetracker://plaid-complete/?session=ls_abc&x=1")).toBe("ls_abc");
    expect(sessionFromDeepLink("financetracker://plaid-complete")).toBeNull();
    expect(sessionFromDeepLink("financetracker://other?session=ls_abc")).toBeNull();
    expect(sessionFromDeepLink("https://evil.example/plaid-complete?session=ls_abc")).toBeNull();
  });
});
