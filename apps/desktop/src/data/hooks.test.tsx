// @vitest-environment happy-dom
/**
 * Targeted refetch: after a change, a query refetches only if it reads one of
 * the changed data slices (the backend reports both); an unspecified change
 * refetches everything.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppTokenContext } from "../shell/context.ts";
import * as client from "../api/client.ts";
import { affects, notifyDataChanged, useQuery } from "./hooks.ts";

function Probe({ name }: { name: string }) {
  const q = useQuery<number>(name);
  return <span data-testid={name}>{q.data ? String(q.data.value) : "…"}</span>;
}

let calls: Record<string, number>;
beforeEach(() => {
  calls = {};
  const needs: Record<string, string[]> = { "goals.list": ["goals", "accounts"], "transactions.list": ["transactions", "overrides"] };
  vi.spyOn(client, "runQuery").mockImplementation(async (_t, name) => {
    calls[name] = (calls[name] ?? 0) + 1;
    return { value: calls[name], figures: {}, needs: needs[name] } as never;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("useQuery refetch after changes", () => {
  it("refetches only queries that read a changed slice; an unspecified change refetches all", async () => {
    render(
      <AppTokenContext.Provider value="t">
        <Probe name="goals.list" />
        <Probe name="transactions.list" />
      </AppTokenContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("transactions.list").textContent).toBe("1"));
    await waitFor(() => expect(screen.getByTestId("goals.list").textContent).toBe("1"));

    act(() => notifyDataChanged(["overrides"]));
    await waitFor(() => expect(screen.getByTestId("transactions.list").textContent).toBe("2"));
    expect(calls["goals.list"]).toBe(1);

    act(() => notifyDataChanged());
    await waitFor(() => expect(screen.getByTestId("goals.list").textContent).toBe("2"));
    await waitFor(() => expect(screen.getByTestId("transactions.list").textContent).toBe("3"));
  });

  it("affects(): unknown needs or unknown changes count as affected", () => {
    expect(affects(undefined, ["x"])).toBe(true);
    expect(affects(["x"], undefined)).toBe(true);
    expect(affects(["a", "b"], ["c"])).toBe(false);
    expect(affects(["a", "b"], ["b"])).toBe(true);
  });
});
