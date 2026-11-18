// @vitest-environment jsdom
/**
 * Budgets window against real core query outputs (flowsFixture, today
 * 2026-10-20): every bar and cell drills down to a figure the query returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { flowsFixture } from "@ft/core/fixtures";
import { createFakeBackend, WithToken, type FakeBackend } from "../goals/testing/fakeBackend.tsx";
import { DRILLDOWN_EVENT, type DrillDownRequest } from "../../data/drilldown.ts";
import { BudgetsWindow } from "./BudgetsWindow.tsx";

const h = vi.hoisted(() => ({ be: null as unknown as FakeBackend }));
vi.mock("../../api/client.ts", async (orig) => ({
  ...(await orig<typeof import("../../api/client.ts")>()),
  runQuery: (t: string, n: string, p: unknown) => h.be.runQuery(t, n, p),
  previewAction: (t: string, n: string, i: unknown) => h.be.previewAction(t, n, i),
  runAction: (t: string, n: string, i: unknown) => h.be.runAction(t, n, i),
  undoAction: (t: string, id: string) => h.be.undoAction(t, id),
}));

let drills: DrillDownRequest[] = [];
const onDrill = (e: Event) => drills.push((e as CustomEvent<DrillDownRequest>).detail);

beforeEach(() => {
  h.be = createFakeBackend(flowsFixture());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00"));
  drills = [];
  window.addEventListener(DRILLDOWN_EVENT, onDrill);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.removeEventListener(DRILLDOWN_EVENT, onDrill);
});

const renderWindow = () =>
  render(
    <WithToken>
      <BudgetsWindow />
    </WithToken>,
  );

/** The figure a drill-down points at, from the real query. */
async function figureOf(d: DrillDownRequest) {
  const r = await h.be.runQuery("t", d.query, d.params);
  return r.figures[d.figureId];
}

describe("Budgets window: this period", () => {
  it("shows the overall bar, a bar per part and Everything else, with status as text", async () => {
    renderWindow();
    await screen.findByText("October 2026");
    for (const id of ["overall", "part_eat", "part_groc", "part_amz", "everything_else"]) expect(screen.getByTestId(`bar-${id}`)).toBeTruthy();
    expect(screen.getByTestId("bar-overall").textContent).toMatch(/of \$3,200/);
    // Status is never colour alone.
    expect(screen.getAllByText(/On pace|Ahead of pace|Over|Under/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pace \$/).length).toBeGreaterThan(0);
  });

  it("every bar figure drills down to a figure the query returns, with the same total", async () => {
    renderWindow();
    await screen.findByText("October 2026");
    const bars = ["overall", "part_eat", "part_groc", "part_amz", "everything_else"];
    for (const id of bars) {
      fireEvent.click(within(screen.getByTestId(`bar-${id}`)).getAllByRole("button", { name: /spent|Show transactions/ })[0]!);
    }
    expect(drills).toHaveLength(bars.length);
    expect(drills[0]).toMatchObject({ query: "budgets.overview", figureId: "budget_monthly.overall.spent" });
    expect(drills[1]!.figureId).toBe("budget_monthly.part.part_eat.spent");
    const overview = await h.be.runQuery("t", "budgets.overview", {});
    const view = (overview.value as { overall: { spentCents: number } }[])[0]!;
    for (const d of drills) expect(await figureOf(d)).toBeTruthy();
    expect((await figureOf(drills[0]!))!.cents).toBe(view.overall.spentCents);
  });

  it("pending shows as a faded extension that drills to the pending figure", async () => {
    renderWindow();
    await screen.findByText("October 2026");
    const pending = screen.getAllByRole("button", { name: /pending, not counted/ });
    expect(pending.length).toBeGreaterThan(0);
    fireEvent.click(pending[0]!);
    expect(drills[0]!.figureId).toMatch(/\.pending$/);
    expect((await figureOf(drills[0]!))!.cents).toBeGreaterThan(0);
    expect(screen.getAllByText(/pending \(not counted\)/).length).toBeGreaterThan(0);
  });

  it("shows the 'Trip: $X this month' line in the overall and drills into it", async () => {
    renderWindow();
    const line = await screen.findByRole("button", { name: /Trip: Lisbon: \$200 this month/ });
    fireEvent.click(line);
    expect(drills[0]!.figureId).toBe("budget_monthly.trip.trip_lisbon.spent");
    expect((await figureOf(drills[0]!))!.cents).toBe(20000);
  });

  it("warns when the parts add up to more than the overall", async () => {
    h.be.data.budgetAmounts = h.be.data.budgetAmounts.map((a) => ({ ...a, amountCents: 30000 }));
    renderWindow();
    expect(await screen.findByText(/more than the overall/)).toBeTruthy();
  });

  it("edits a part through budgets.editPart after a before → after preview", async () => {
    renderWindow();
    await screen.findByText("October 2026");
    fireEvent.click(screen.getByRole("button", { name: "Edit Groceries" }));
    const amount = screen.getByLabelText("Expected per period ($)");
    fireEvent.change(amount, { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", { name: 'Edit "Groceries"' });
    await within(dialog).findByText("$250.00");
    expect(within(dialog).getByText("$300.00")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.be.actions("budgets.editPart")).toEqual([{ partId: "part_groc", expectedCents: 30000 }]));
  });

  it("creates a budget from the empty state, monthly by default", async () => {
    h.be.data.budgets = [];
    renderWindow();
    fireEvent.click(await screen.findByRole("button", { name: "Create a budget" }));
    fireEvent.change(screen.getByLabelText("Overall amount per period ($)"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.be.actions("budgets.create")).toEqual([{ name: "Monthly spending", amountCents: 300000, periodKind: "monthly", customEndDate: null }]));
  });
});

describe("Budgets window: trips and history", () => {
  it("each trip has its own bar across its dates that drills down", async () => {
    renderWindow();
    await screen.findByText("October 2026");
    fireEvent.click(screen.getByRole("tab", { name: "Trips" }));
    const bar = await screen.findByTestId("bar-trip_lisbon");
    expect(bar.textContent).toMatch(/\$700 of \$1,000/);
    fireEvent.click(within(bar).getAllByRole("button")[0]!);
    expect(drills[0]).toMatchObject({ query: "budgets.trips", figureId: "trip_lisbon.spent" });
    expect((await figureOf(drills[0]!))!.cents).toBe(70000);
    fireEvent.click(screen.getByRole("button", { name: /September 2026: \$500/ }));
    expect(drills[1]!.figureId).toBe("trip_lisbon.month.2026-09");
  });

  it("planned vs actual, the history grid and the track record drill down per cell", async () => {
    renderWindow();
    await screen.findByText("October 2026");
    fireEvent.click(screen.getByRole("tab", { name: "How I did" }));
    expect(await screen.findByText(/Planned vs actual · September 2026/)).toBeTruthy();
    const cells = await screen.findAllByRole("button", { name: /Eating out, .*Show transactions/ });
    expect(cells.length).toBe(4); // Jul–Oct: the budget started in July
    fireEvent.click(cells[cells.length - 2]!); // September
    expect(drills[0]!.query).toBe("budgets.history");
    expect(await figureOf(drills[0]!)).toBeTruthy();
    expect(screen.getAllByText(/within plan/).length).toBeGreaterThan(0);
  });
});
