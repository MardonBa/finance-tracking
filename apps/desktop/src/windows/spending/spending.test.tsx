// @vitest-environment happy-dom
/**
 * Spending window (§8) against REAL core outputs (registry queries on the
 * core-flows fixture). The key check (§7): for every figure, bar, segment and
 * cell the window can click, the drill-down list's total equals the figure.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Money } from "@ft/core";
import { DRILLDOWN_EVENT, MERCHANT_EVENT, type DrillDownRequest, type MerchantRequest } from "../../data/drilldown.ts";
import { calls, resetCore, runCoreQuery, TODAY } from "../../test/coreBackend.tsx";
import { renderInWindow } from "../../test/render.tsx";
import { SpendingWindow, type SpendingTab } from "./SpendingWindow.tsx";
import { sankeyClickFigure, type SANKEY_DEFAULTS } from "./SankeyPanel.tsx";
import { TransactionsWindow } from "../transactions/TransactionsWindow.tsx";

vi.mock("../../api/client.ts", async () => (await import("../../test/coreBackend.tsx")).clientMock);
// ECharts needs a real canvas; the Sankey's click mapping is tested directly below.
vi.mock("../../ui/Chart.tsx", () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

const MONTH = TODAY.slice(0, 7);
const TABS: SpendingTab[] = ["flow", "categories", "merchants", "calendar", "saving", "necessary", "worth"];
const TAB_LABEL: Record<SpendingTab, string> = {
  flow: "Flow",
  categories: "Categories",
  merchants: "Merchants",
  calendar: "Calendar",
  saving: "Saving",
  necessary: "Necessary?",
  worth: "Worth a look",
};

/** Everything in the Spending window that is a drill-down target. */
const DRILL_SELECTOR = [
  ".ui-stat__drill",
  ".sp-inline-drill:not(:disabled)",
  "button.minibars__hit",
  "button.sp-heat__cell",
  "button.spark__hit",
  ".sp-sankey__list button",
].join(", ");

let drills: DrillDownRequest[] = [];
let merchants: MerchantRequest[] = [];
const onDrill = (e: Event) => drills.push((e as CustomEvent<DrillDownRequest>).detail);
const onMerchant = (e: Event) => merchants.push((e as CustomEvent<MerchantRequest>).detail);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});

beforeEach(() => {
  resetCore();
  drills = [];
  merchants = [];
  window.addEventListener(DRILLDOWN_EVENT, onDrill);
  window.addEventListener(MERCHANT_EVENT, onMerchant);
});

afterEach(() => {
  cleanup();
  window.removeEventListener(DRILLDOWN_EVENT, onDrill);
  window.removeEventListener(MERCHANT_EVENT, onMerchant);
});

async function loaded() {
  await waitFor(() => {
    expect(screen.queryByTestId("monthly-summary")).not.toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
}

async function openTab(tab: SpendingTab) {
  fireEvent.click(screen.getByRole("tab", { name: TAB_LABEL[tab] }));
  await loaded();
}

/** The figure a drill request points at, from the same query run the window made. */
function figureOf(req: DrillDownRequest) {
  return runCoreQuery(req.query, req.params).figures[req.figureId];
}

function expectDrillMatches(req: DrillDownRequest) {
  const fig = figureOf(req);
  expect(fig, `${req.query} has figure ${req.figureId}`).toBeDefined();
  const dd = runCoreQuery<{ totalCents: number; groups: { totalCents: number }[] }>("transactions.drillDown", {
    query: req.query,
    params: req.params,
    figure: req.figureId,
  }).value;
  expect(dd.totalCents, `${req.query} ${req.figureId}`).toBe(fig!.cents);
  expect(dd.groups.reduce((s, g) => s + g.totalCents, 0)).toBe(fig!.cents);
  expect(req.label).toBe(fig!.label ?? req.figureId);
}

describe("Spending window", { timeout: 30_000 }, () => {
  it("shows the monthly summary with comparisons and says which months usual uses", async () => {
    renderInWindow(<SpendingWindow initialMonth={MONTH} />, "spending");
    await loaded();
    const s = runCoreQuery<{ incomeCents: number; spendingCents: number; savedCents: number; usual: { basis: { label: string } } }>("spending.monthlySummary", {
      month: MONTH,
      usualMonths: 3,
    }).value;
    const summary = screen.getByTestId("monthly-summary");
    expect(within(summary).getByRole("button", { name: new RegExp(`^Income.*: \\$${Money.format(s.incomeCents).slice(1)}\\. Show transactions$`) })).toBeTruthy();
    expect(within(summary).getByRole("button", { name: `Spending: ${Money.format(s.spendingCents)}. Show transactions` })).toBeTruthy();
    expect(screen.getByTestId("usual-basis").textContent).toContain(s.usual.basis.label);

    // Changing "usual" to 1 month re-runs the summary and says so.
    fireEvent.click(screen.getByRole("radio", { name: "1 month" }));
    await waitFor(() => expect(screen.getByTestId("usual-basis").textContent).toContain("1 month chosen"));
    const one = runCoreQuery<{ usual: { basis: { label: string } } }>("spending.monthlySummary", { month: MONTH, usualMonths: 1 }).value;
    expect(screen.getByTestId("usual-basis").textContent).toContain(one.usual.basis.label);
  });

  it("every clickable figure, bar, segment and cell drills to a list whose total equals it", async () => {
    renderInWindow(<SpendingWindow initialMonth={MONTH} />, "spending");
    await loaded();
    const perTab: Record<string, number> = {};
    for (const tab of TABS) {
      await openTab(tab);
      const before = drills.length;
      const targets = [...document.querySelectorAll<HTMLElement>(DRILL_SELECTOR)];
      // Worth a look: the "Show the $…" buttons.
      targets.push(...screen.queryAllByRole("button", { name: /^Show the / }));
      for (const el of targets) fireEvent.click(el);
      perTab[tab] = drills.length - before;
    }
    // Every tab has something to drill into on this fixture.
    for (const tab of TABS) expect(perTab[tab], tab).toBeGreaterThan(0);
    expect(drills.length).toBeGreaterThan(60);
    for (const req of drills) expectDrillMatches(req);
  });

  it("every Sankey link and node maps to a figure whose drill-down total equals it", () => {
    const params: { month: string } & typeof SANKEY_DEFAULTS = { month: MONTH, maxSources: 5, merchantsPerCategory: 3 };
    const { value, figures } = runCoreQuery<Parameters<typeof sankeyClickFigure>[0]>("spending.sankey", params);
    expect(value.links.length).toBeGreaterThan(5);
    const keys = [
      ...value.links.map((l) => sankeyClickFigure(value, { dataType: "edge", data: { figure: l.figure } })),
      ...value.nodes.map((n) => sankeyClickFigure(value, { dataType: "node", data: { name: n.id } })),
    ];
    for (const key of keys) {
      expect(key).not.toBeNull();
      expectDrillMatches({ query: "spending.sankey", params, figureId: key!, label: figures[key!]!.label ?? key! });
    }
  });

  it("the Transactions window shows the clicked figure's label and a total equal to it", async () => {
    renderInWindow(<SpendingWindow initialMonth={MONTH} />, "spending");
    await loaded();
    const samples: DrillDownRequest[] = [];
    for (const tab of TABS) {
      await openTab(tab);
      const first = document.querySelector<HTMLElement>(DRILL_SELECTOR) ?? screen.queryAllByRole("button", { name: /^Show the / })[0];
      if (!first) continue;
      fireEvent.click(first);
      samples.push(drills[drills.length - 1]!);
    }
    cleanup();
    renderInWindow(<TransactionsWindow />);
    for (const req of samples) {
      act(() => {
        window.dispatchEvent(new CustomEvent(DRILLDOWN_EVENT, { detail: req }));
      });
      const fig = figureOf(req)!;
      await waitFor(() => expect(screen.getByTestId("drill-total").textContent).toBe(Money.format(fig.cents)));
      expect(within(screen.getByTestId("filter-header")).getByRole("heading").textContent).toBe(req.label);
    }
  });

  it("merchants open the merchant view", async () => {
    renderInWindow(<SpendingWindow initialMonth={MONTH} />, "spending");
    await loaded();
    await openTab("merchants");
    const top = runCoreQuery<{ merchantKey: string; name: string }[]>("spending.topMerchants", {
      from: `${MONTH}-01`,
      to: `${MONTH}-31`,
      limit: 10,
      trendMonths: 12,
    }).value[0]!;
    fireEvent.click(screen.getByRole("button", { name: top.name }));
    expect(merchants).toEqual([{ merchantKey: top.merchantKey, label: top.name }]);
  });

  it("shows empty states when there is no data", async () => {
    const { emptyData } = await import("@ft/core");
    resetCore(emptyData());
    renderInWindow(<SpendingWindow initialMonth={MONTH} />, "spending");
    await loaded();
    expect(screen.getByText("Nothing came in or went out this month")).toBeTruthy();
    await openTab("categories");
    expect(screen.getByText("No spending in these months")).toBeTruthy();
    await openTab("worth");
    expect(screen.getByText("Nothing on your cutting-back list")).toBeTruthy();
  });

  it("labelling a category runs the action and every query refetches", async () => {
    renderInWindow(<SpendingWindow initialMonth={MONTH} />, "spending");
    await loaded();
    await openTab("necessary");
    const queriesBefore = calls.filter((c) => c.kind === "query" && c.name === "spending.necessity").length;
    const group = screen.getAllByRole("radiogroup", { name: /^Is .* necessary\?$/ })[0]!;
    fireEvent.click(within(group).getByRole("radio", { name: "Not necessary" }));
    await waitFor(() => expect(calls.some((c) => c.kind === "action" && c.name === "spending.setNecessityLabel")).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.kind === "query" && c.name === "spending.necessity").length).toBeGreaterThan(queriesBefore));
    await waitFor(() => expect(within(screen.getAllByRole("radiogroup", { name: /^Is .* necessary\?$/ })[0]!).getByRole("radio", { name: "Not necessary" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("status").textContent).toContain("Not necessary");
  });
});
