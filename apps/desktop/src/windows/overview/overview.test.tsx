// @vitest-environment jsdom
/**
 * Overview (§13) against REAL core outputs (the core-flows fixture): the
 * alerts strip appears only when needed, out-of-date accounts are marked,
 * and every element clicks through to its window or transactions.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DRILLDOWN_EVENT, OPEN_ITEM_EVENT, type DrillDownRequest, type OpenItemRequest } from "../../data/drilldown.ts";
import { resetCore, runCoreQuery, TODAY } from "../testing/coreApi.ts";
import { renderInWindow } from "../testing/render.tsx";
import type { ConnectionHealth } from "../../connections/api.ts";
import { computeAlerts } from "./alerts.ts";
import { OverviewWindow } from "./OverviewWindow.tsx";

const h = vi.hoisted(() => ({ connections: [] as unknown[] }));
vi.mock("../../api/client.ts", async () => {
  const { clientMock } = await import("../testing/coreApi.ts");
  return {
    ...clientMock,
    apiRequest: async (path: string) => {
      if (path === "/connections") return { items: h.connections };
      if (path === "/auth/credentials") return { credentials: [] };
      return {};
    },
  };
});

const healthy: ConnectionHealth = {
  itemId: "item_bank",
  institutionName: "First Platypus",
  status: "ok",
  errorCode: null,
  message: "First Platypus is up to date",
  needsReconnect: false,
  lastUpdatedAt: `${TODAY}T06:00:00.000Z`,
  lastUpdatedSource: "plaid",
  consentExpiresAt: null,
  importStatus: "up_to_date",
  syncing: false,
  refreshAvailableAt: null,
  accountCount: 4,
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
beforeEach(() => {
  resetCore();
  h.connections = [healthy];
});
afterEach(() => cleanup());

function capture() {
  const drill: DrillDownRequest[] = [];
  const items: OpenItemRequest[] = [];
  const d = (e: Event) => drill.push((e as CustomEvent<DrillDownRequest>).detail);
  const i = (e: Event) => items.push((e as CustomEvent<OpenItemRequest>).detail);
  window.addEventListener(DRILLDOWN_EVENT, d);
  window.addEventListener(OPEN_ITEM_EVENT, i);
  return { drill, items, off: () => (window.removeEventListener(DRILLDOWN_EVENT, d), window.removeEventListener(OPEN_ITEM_EVENT, i)) };
}

describe("computeAlerts (the strip appears only when needed)", () => {
  it("is empty when all is good", () => {
    expect(computeAlerts({ lowBalance: [], connections: [healthy], unexplainedCount: 0, needsALookCount: 0 })).toEqual([]);
    expect(computeAlerts({})).toEqual([]);
  });

  it("lists a projected below-zero balance, a bank to reconnect, unexplained differences and Needs a look", () => {
    const alerts = computeAlerts({
      lowBalance: [{ accountId: "acc_checking", accountName: "Checking", shortfallCents: 12000, date: "2026-11-03", message: "Checking is projected to be $120.00 short on Nov 3, 2026." }],
      connections: [healthy, { ...healthy, itemId: "b", status: "login_required", needsReconnect: true, message: "Chase needs you to sign in again" }],
      unexplainedCount: 1,
      needsALookCount: 3,
    });
    expect(alerts.map((a) => a.kind)).toEqual(["reconnect", "low-balance", "unexplained", "needs-a-look"]);
    expect(alerts[0]).toMatchObject({ itemId: "b", text: "Chase needs you to sign in again", action: "Reconnect" });
    expect(alerts[3]!.text).toBe("3 items in Needs a look");
  });

  it("groups several broken banks into one line", () => {
    const bad = { ...healthy, status: "error" as const };
    const alerts = computeAlerts({ connections: [{ ...bad, itemId: "a" }, { ...bad, itemId: "b" }] });
    expect(alerts).toEqual([{ id: "reconnect", kind: "reconnect", text: "2 banks need attention", action: "Fix" }]);
  });
});

describe("OverviewWindow", { timeout: 30_000 }, () => {
  it("shows every card with real numbers, and the strip only for what the data needs", async () => {
    renderInWindow(<OverviewWindow />, "overview");
    const nw = runCoreQuery<{ totalCents: number }>("balances.netWorth", {}).value.totalCents;
    await waitFor(() => expect(document.querySelector(".ov")?.getAttribute("data-ready")).toBe("true"));
    for (const title of ["Net worth", "Spending this month", "Accounts", "Recent spending", "Goals"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`^Net worth .*${Math.abs(Math.round(nw / 100)).toLocaleString("en-US").slice(0, 3)}`) })).toBeTruthy();

    // The strip mirrors exactly what the queries report.
    const needs = runCoreQuery<{ count: number }>("flows.needsALook", {}).value.count;
    const strip = screen.queryByRole("list", { name: "Needs attention" });
    if (needs > 0) expect(within(strip!).getByText(`${needs} item${needs === 1 ? "" : "s"} in Needs a look`)).toBeTruthy();
    expect(screen.queryByText(/need attention|needs you to sign in/)).toBeNull();
  });

  it("shows no strip at all when nothing needs attention", async () => {
    // A ledger with nothing to look at: no transactions.
    const { coreData } = await import("../testing/coreApi.ts");
    const data = coreData();
    resetCore({ ...data, transactions: [], recurringItems: [], balanceSnapshots: data.balanceSnapshots.filter(() => false) });
    renderInWindow(<OverviewWindow />, "overview");
    await waitFor(() => expect(document.querySelector(".ov")?.getAttribute("data-ready")).toBe("true"));
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());
    expect(screen.queryByRole("list", { name: "Needs attention" })).toBeNull();
  });

  it("a bank needing reconnection appears in the strip and marks its accounts out of date, with the totals saying so", async () => {
    h.connections = [{ ...healthy, status: "login_required", needsReconnect: true, message: "First Platypus needs you to sign in again" }];
    renderInWindow(<OverviewWindow />, "overview");
    const strip = await screen.findByRole("list", { name: "Needs attention" });
    expect(within(strip).getByText("First Platypus needs you to sign in again")).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Reconnect" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Out of date/).length).toBeGreaterThan(0));
    expect(screen.getByText(/out-of-date account/)).toBeTruthy();
  });

  it("every element clicks through: breakdown → Spending/drill-down, transaction → Transactions, budget and goal → their windows", async () => {
    const cap = capture();
    try {
      renderInWindow(<OverviewWindow />, "overview");
      await waitFor(() => expect(document.querySelector(".ov")?.getAttribute("data-ready")).toBe("true"));

      fireEvent.click(screen.getByRole("button", { name: "Open Spending" }));
      expect(cap.items.at(-1)).toEqual({ area: "spending" });

      fireEvent.click(screen.getByRole("button", { name: /this month\. Show transactions/ }));
      expect(cap.drill.at(-1)).toMatchObject({ query: "spending.monthlySummary", figureId: "spending" });

      const seg = await screen.findAllByRole("listitem", { name: /Show transactions/ });
      const firstReal = seg.find((s) => !/^Other:/.test(s.getAttribute("aria-label") ?? ""))!;
      fireEvent.click(firstReal);
      const req = cap.drill.at(-1)!;
      expect(req.query).toBe("spending.byCategory");
      // The figure the drill-down names exists and adds up.
      const fig = runCoreQuery(req.query, req.params).figures[req.figureId]!;
      expect(fig.contributions.reduce((s, c) => s + c.cents, 0)).toBe(fig.cents);

      const tx = (await screen.findAllByRole("button", { name: /Transaction details$/ }))[0]!;
      fireEvent.click(tx);
      const txReq = cap.drill.at(-1)!;
      expect(txReq.query).toBe("transactions.list");
      expect(runCoreQuery<{ count: number }>(txReq.query, txReq.params).value.count).toBeGreaterThanOrEqual(1);

      const budget = screen.queryAllByRole("button", { name: /Open Budgets$/ });
      if (budget.length > 0) {
        fireEvent.click(budget[budget.length - 1]!);
        expect(cap.items.at(-1)?.area).toBe("budgets");
      }
      fireEvent.click(screen.getByRole("button", { name: "Open Goals" }));
      expect(cap.items.at(-1)).toEqual({ area: "goals", itemId: undefined });
      const goal = screen.queryAllByRole("button", { name: /saved, .*Open Goals$/ });
      if (goal.length > 0) {
        fireEvent.click(goal[0]!);
        expect(cap.items.at(-1)).toMatchObject({ area: "goals", itemId: expect.any(String) });
      }
      fireEvent.click(screen.getByRole("button", { name: /^Net worth .*Open Trajectory/ }));
      expect(cap.items.at(-1)).toEqual({ area: "trajectory" });
    } finally {
      cap.off();
    }
  });
});
