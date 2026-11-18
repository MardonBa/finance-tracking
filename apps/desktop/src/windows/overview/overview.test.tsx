// @vitest-environment jsdom
/**
 * Overview (§13) against REAL core outputs (the core-flows fixture): the
 * alerts strip appears only when needed, out-of-date accounts are marked,
 * and every element clicks through to its window or transactions.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Money } from "@ft/core";
import { DRILLDOWN_EVENT, OPEN_ITEM_EVENT, type DrillDownRequest, type OpenItemRequest } from "../../data/drilldown.ts";
import { resetCore, runCoreQuery, TODAY } from "../../test/coreBackend.tsx";
import { renderInWindow } from "../../test/render.tsx";
import type { ConnectionHealth } from "../../connections/api.ts";
import { computeAlerts } from "./alerts.ts";
import { OverviewWindow } from "./OverviewWindow.tsx";

const h = vi.hoisted(() => ({ connections: [] as unknown[] }));
vi.mock("../../api/client.ts", async () => {
  const { clientMock } = await import("../../test/coreBackend.tsx");
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
    const { coreData } = await import("../../test/coreBackend.tsx");
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

  it("each card shows what §13 asks for, with no clicks: spending vs usual by category, recent spending, budget pace, net worth change and trend, account freshness", async () => {
    // Balances from a month ago, so "since last month" has something to compare with.
    const { coreData } = await import("../../test/coreBackend.tsx");
    const d = coreData();
    resetCore({ ...d, balanceSnapshots: [...d.balanceSnapshots, ...d.balanceSnapshots.filter((x) => x.date === "2026-09-30").map((x) => ({ ...x, date: "2026-09-20" }))] });
    renderInWindow(<OverviewWindow />, "overview");
    await waitFor(() => expect(document.querySelector(".ov")?.getAttribute("data-ready")).toBe("true"));
    // Spending: this month's total, compared with usual, split by category.
    const sum = runCoreQuery<{ spendingCents: number; usual: { spendingCents: number } | null }>("spending.monthlySummary", { month: TODAY.slice(0, 7), usualMonths: 3 }).value;
    expect(screen.getByRole("button", { name: `Spent ${Money.format(sum.spendingCents)} this month. Show transactions` })).toBeTruthy();
    const card = (cls: string) => document.querySelector(`.${cls}`) as HTMLElement;
    if (sum.usual) expect(within(card("ov-spending")).getByText(/(more|less) than usual$/)).toBeTruthy();
    const cats = within(screen.getByRole("list", { name: "Spending by category" })).getAllByRole("listitem");
    expect(cats.length).toBeGreaterThan(1);
    // Recent spending: at least 7 latest, each with merchant, category, amount and date.
    const rows = runCoreQuery<{ rows: { merchantName: string | null; amountCents: number; categoryLabel: string | null }[] }>("transactions.list", {
      measure: "amount", buckets: ["spending"], includePending: true, to: TODAY, limit: 10,
    }).value.rows;
    const shown = within(card("ov-recent")).getAllByRole("button", { name: /Transaction details$/ });
    expect(shown).toHaveLength(Math.min(7, rows.length));
    shown.forEach((b, i) => {
      expect(b.getAttribute("aria-label")).toContain(`${rows[i]!.merchantName}, ${Money.format(rows[i]!.amountCents)}, `);
      expect(b.textContent).toContain(rows[i]!.categoryLabel ?? "Uncategorised");
    });
    // Budget: the overall bar with its pace marker, and the parts that are over or running hot (or "every part is on pace").
    const b = runCoreQuery<{ name: string; overall: { spentCents: number; plannedCents: number } }[]>("budgets.overview", {}).value[0]!;
    expect(screen.getByRole("button", { name: `${b.name}: ${Money.format(b.overall.spentCents)} of ${Money.format(b.overall.plannedCents)}. Open Budgets` })).toBeTruthy();
    expect(card("ov-budgets").querySelector(".ov-bar__pace")).not.toBeNull();
    expect(within(card("ov-budgets")).queryAllByRole("button", { name: /: (Over|Running hot)\. Open Budgets$/ }).length > 0 || within(card("ov-budgets")).queryByText("Every part is on pace.") !== null).toBe(true);
    // Net worth: the change since a month ago and a small trend line.
    expect(within(card("ov-networth")).getByText(/since Sep 20$/)).toBeTruthy();
    expect(card("ov-networth").querySelector("svg.ov-spark polyline")).not.toBeNull();
    // Accounts: each with its balance and when it was last updated.
    const accounts = within(card("ov-accounts")).getAllByRole("button", { name: /Account details$/ });
    expect(accounts.length).toBeGreaterThan(0);
    for (const a of accounts) expect(a.textContent).toMatch(/Updated |Entered by hand|Out of date/);
  });

  it("the goals card shows each goal's picture, progress and whether it's on track", async () => {
    const { goalsFixture } = await import("@ft/core/fixtures");
    resetCore(goalsFixture().data);
    renderInWindow(<OverviewWindow />, "overview");
    const goals = runCoreQuery<{ goals: { name: string; percent: number }[] }>("goals.list", {}).value.goals;
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals.slice(0, 4)) {
      const btn = await screen.findByRole("button", { name: new RegExp(`^${g.name}: ${Math.round(g.percent)}% saved, (Reached|On track|Behind|Past deadline|.+)\\. Open Goals$`) });
      expect(btn.querySelector(".ov-goal__pic")).not.toBeNull();
      expect(btn.querySelector(".ov-goal__fill")).not.toBeNull();
      expect(btn.querySelector(".ui-status")).not.toBeNull(); // status as icon + text, never colour alone
    }
  });

  it("the alerts strip's Needs a look and unexplained items open the Transactions window on those views", async () => {
    const cap = capture();
    try {
      renderInWindow(<OverviewWindow />, "overview");
      const strip = await screen.findByRole("list", { name: "Needs attention" });
      const rec = runCoreQuery<{ unexplainedCount: number }>("flows.reconciliation", { from: `${TODAY.slice(0, 7)}-01`, to: TODAY }).value.unexplainedCount;
      expect(rec).toBeGreaterThan(0);
      const items = within(strip).getAllByRole("listitem");
      for (const li of items) {
        const text = li.textContent ?? "";
        if (/Needs a look/.test(text)) {
          fireEvent.click(within(li).getByRole("button"));
          expect(cap.items.at(-1)).toEqual({ area: "transactions", itemId: "needs-a-look" });
        }
        if (/unexplained/i.test(text)) {
          fireEvent.click(within(li).getByRole("button"));
          expect(cap.items.at(-1)).toEqual({ area: "transactions", itemId: "reconciliation" });
        }
      }
      expect(cap.items.map((i) => i.itemId)).toEqual(expect.arrayContaining(["needs-a-look", "reconciliation"]));
    } finally {
      cap.off();
    }
  });

  it("'Add account' offers a bank (the same Plaid flow) or a manual account; accounts show importing, then updated, and manual ones are labelled", async () => {
    const { render } = await import("@testing-library/react");
    const { AppTokenContext, WindowContext } = await import("../../shell/context.ts");
    const { CONNECTIONS_CHANGED_EVENT } = await import("../../connections/useConnections.ts");
    const addBanks = vi.fn();
    h.connections = [{ ...healthy, importStatus: "importing" }];
    const win = { area: "overview" as const, token: "t", open() {}, close() {}, minimize() {}, addBanks };
    render(
      <AppTokenContext.Provider value="t">
        <WindowContext.Provider value={win}>
          <OverviewWindow />
        </WindowContext.Provider>
      </AppTokenContext.Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Add account" }));
    const menu = screen.getByRole("menu", { name: "Add account" });
    expect(within(menu).getByRole("menuitem", { name: /Manual account/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Bank or card/ }));
    expect(addBanks).toHaveBeenCalledTimes(1);
    // While the bank's history downloads, its accounts say so; then they show when they were updated.
    const card = () => document.querySelector(".ov-accounts") as HTMLElement;
    await waitFor(() => expect(within(card()).getAllByText("Importing transactions…").length).toBeGreaterThan(0));
    h.connections = [healthy];
    window.dispatchEvent(new Event(CONNECTIONS_CHANGED_EVENT));
    await waitFor(() => expect(within(card()).queryByText("Importing transactions…")).toBeNull());
    expect(within(card()).getAllByText(/^Updated /).length).toBeGreaterThan(0);
    // The manual cash account is labelled as manual (in "All accounts" if it doesn't fit the card).
    const more = within(card()).queryByRole("button", { name: /more accounts$/ });
    if (more) fireEvent.click(more);
    const cash = (await screen.findAllByRole("button", { name: /^Cash\. Account details$/ })).at(-1)!;
    expect(within(cash).getByText("Manual")).toBeTruthy();
    expect(within(cash).getByText("Entered by hand")).toBeTruthy();
  });
});
