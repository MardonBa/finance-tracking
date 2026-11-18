// @vitest-environment jsdom
/** The connection flow driver: system browser, deep link return, polling fallback, nothing saved on cancel. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FinalizeResult } from "./api.ts";
import { DEEP_LINK_EVENT, defaultConnectDeps, useConnectFlow, type ConnectDeps } from "./useConnectFlow.ts";

afterEach(() => cleanup());

const done: FinalizeResult = { status: "done", sessionId: "ls_1", itemId: "item_1", institutionName: "First Platypus", accounts: [] };

function fakeDeps(over: Partial<ConnectDeps> = {}): ConnectDeps & { finalize: ReturnType<typeof vi.fn>; openUrl: ReturnType<typeof vi.fn> } {
  const listeners = new Set<(u: string) => void>();
  return {
    getLimit: vi.fn(async () => ({ count: 1, limit: 10, remaining: 9, status: "ok" as const })),
    createSession: vi.fn(async () => ({ sessionId: "ls_1", hostedLinkUrl: "https://secure.plaid.com/hl/abc", expiresAt: "", mode: "new" as const })),
    finalize: vi.fn(async () => ({ status: "pending", sessionId: "ls_1" }) as FinalizeResult),
    resolveDuplicate: vi.fn(async () => done),
    openUrl: vi.fn(async () => undefined),
    onDeepLink: (cb: (u: string) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    pollMs: 60_000,
    ...over,
    // expose for the test
    ...({ emit: (u: string) => listeners.forEach((l) => l(u)) } as object),
  } as never;
}

describe("useConnectFlow", () => {
  it("opens Hosted Link in the system browser, then finalizes when the deep link arrives", async () => {
    const deps = fakeDeps();
    const { result } = renderHook(() => useConnectFlow(deps));
    await waitFor(() => expect(result.current.state.limit?.status).toBe("ok"));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.current.step).toBe("waiting"));
    expect(deps.openUrl).toHaveBeenCalledWith("https://secure.plaid.com/hl/abc");

    deps.finalize.mockResolvedValueOnce(done);
    // A link for another session is ignored; ours triggers finalize.
    act(() => (deps as unknown as { emit: (u: string) => void }).emit("financetracker://plaid-complete?session=ls_other"));
    expect(deps.finalize).not.toHaveBeenCalled();
    act(() => (deps as unknown as { emit: (u: string) => void }).emit("financetracker://plaid-complete?session=ls_1"));
    await waitFor(() => expect(result.current.state.current.step).toBe("connected"));
    expect(deps.finalize).toHaveBeenCalledWith("ls_1");
    expect(result.current.state.banks.map((b) => b.itemId)).toEqual(["item_1"]);
  });

  it("polls when no deep link comes back", async () => {
    vi.useFakeTimers();
    try {
      const deps = fakeDeps({ pollMs: 1000 });
      deps.finalize.mockResolvedValueOnce({ status: "pending", sessionId: "ls_1" }).mockResolvedValueOnce(done);
      const { result } = renderHook(() => useConnectFlow(deps));
      await act(async () => {
        result.current.start();
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(result.current.state.current.step).toBe("waiting");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.state.current.step).toBe("waiting");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.state.current.step).toBe("connected");
      expect(deps.finalize).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel stops waiting without calling finalize; retry starts a new session", async () => {
    const deps = fakeDeps();
    const { result } = renderHook(() => useConnectFlow(deps));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.current.step).toBe("waiting"));
    act(() => result.current.cancel());
    expect(result.current.state.current.step).toBe("cancelled");
    expect(deps.finalize).not.toHaveBeenCalled();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.current.step).toBe("waiting"));
    expect(deps.createSession).toHaveBeenCalledTimes(2);
  });

  it("the default deps listen to the shell's ft:deep-link event", () => {
    const deps = defaultConnectDeps("t");
    const seen: string[] = [];
    const off = deps.onDeepLink((u) => seen.push(u));
    window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail: "financetracker://plaid-complete?session=ls_9" }));
    off();
    window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail: "financetracker://x" }));
    expect(seen).toEqual(["financetracker://plaid-complete?session=ls_9"]);
  });
});
