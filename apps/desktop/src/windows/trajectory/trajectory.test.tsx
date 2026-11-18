// @vitest-environment jsdom
/** §5 "Seeing it" and §12 Trajectory window against real core outputs (fixtures from @ft/core). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eachDay, queryRegistry, type CoreData } from "@ft/core";
import { basicFixture } from "@ft/core/fixtures";
import { DRILLDOWN_EVENT, type DrillDownRequest } from "../../data/drilldown.ts";
import { installCoreBackend, type CoreBackend } from "../../test/coreBackend.tsx";
import { renderWithToken } from "../../test/render.tsx";
import { lastChart } from "../../test/chartStub.tsx";
import { money } from "../shared/format.ts";
import { TrajectoryWindow } from "./TrajectoryWindow.tsx";

vi.mock("../../ui/Chart.tsx", () => import("../../test/chartStub.tsx"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 31, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Basic fixture plus balance history: checking rebuilt (estimated) before Sep 1, real snapshots after. */
function historyFixture() {
  const { data, today } = basicFixture();
  data.balanceSnapshots = [
    ...eachDay("2026-07-01", "2026-08-31").map((d) => ({ accountId: "acc_checking", date: d, balanceCents: 300000, source: "rebuilt" as const, isEstimated: true, isCarriedForward: false })),
    ...eachDay("2026-09-01", "2026-10-31").flatMap((d) => [
      { accountId: "acc_checking", date: d, balanceCents: 352310, source: "plaid" as const, isEstimated: false, isCarriedForward: false },
      { accountId: "acc_card", date: d, balanceCents: -18999, source: "plaid" as const, isEstimated: false, isCarriedForward: false },
      { accountId: "acc_brokerage", date: d, balanceCents: 2104500, source: "plaid" as const, isEstimated: false, isCarriedForward: false },
    ]),
  ];
  return { data, today };
}

function lastBody(backend: CoreBackend, name: string): Record<string, unknown> {
  return backend.callsTo(name).at(-1)!.input as Record<string, unknown>;
}

function coreProjection(data: CoreData, today: string, params: unknown) {
  const q = queryRegistry.get("trajectory.projection")!;
  return q.run(data as never, q.params.parse(params), today).value as { points: Array<{ totalCents: number }> };
}

async function openTab(name: string) {
  await userEvent.click(await screen.findByRole("tab", { name }));
}

function captureDrillDowns() {
  const seen: DrillDownRequest[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent<DrillDownRequest>).detail);
  window.addEventListener(DRILLDOWN_EVENT, listener);
  return { seen, stop: () => window.removeEventListener(DRILLDOWN_EVENT, listener) };
}

describe("Trajectory: net worth stacked by account (§5)", () => {
  it("marks estimated history, says where each account's history starts, and shows date + each account + total on hover", async () => {
    installCoreBackend(historyFixture());
    renderWithToken(<TrajectoryWindow />);
    const note = await screen.findByTestId("estimated-note");
    expect(note.textContent).toContain("Checking until Aug 31, 2026");
    const starts = screen.getByRole("list", { name: "Where each account's history starts" }).textContent!;
    expect(starts).toContain("Checking: history starts here, Jul 1, 2026. Rebuilt from transactions before the account was connected (estimated).");
    expect(starts).toContain("Plaid Brokerage: history starts here, Sep 1, 2026. Investment values change with the market");

    const chart = lastChart(/Net worth over time/)!;
    const option = chart.option as {
      series: Array<{ name: string; stack?: string; markArea?: { data: Array<[{ name: string }, unknown]> }; markLine?: { data: Array<{ name: string }> } }>;
      tooltip: { formatter: (p: Array<{ dataIndex: number }>) => string };
    };
    // Assets stack above zero, debts below.
    expect(option.series.find((s) => s.name === "Plaid Credit Card")!.stack).toBe("debts");
    expect(option.series.find((s) => s.name === "Checking")!.stack).toBe("assets");
    const total = option.series.find((s) => s.name === "Net worth")!;
    expect(total.markArea!.data[0]![0].name).toBe("Estimated (rebuilt from transactions)");
    expect(total.markLine!.data.map((d) => d.name)).toEqual(["History starts: Plaid Credit Card, Plaid Brokerage"]);
    const hover = option.tooltip.formatter([{ dataIndex: 3 }]);
    expect(hover).toContain("Oct 31, 2026");
    expect(hover).toContain("Checking: <b>$3,523.10</b>");
    expect(hover).toContain("Plaid Credit Card: <b>-$189.99</b>");
    expect(hover).toContain("Total: <b>$24,378.11</b>");
    const julyHover = option.tooltip.formatter([{ dataIndex: 0 }]);
    expect(julyHover).toContain("Checking: <b>$3,000.00</b> <i>(estimated)</i>");
  });

  it("switches between all accounts and grouped by type", async () => {
    const backend = installCoreBackend(historyFixture());
    renderWithToken(<TrajectoryWindow />);
    await screen.findByTestId("estimated-note");
    await userEvent.click(screen.getByRole("radio", { name: "By type" }));
    await waitFor(() => expect(lastBody(backend, "balances.netWorthChart").grouping).toBe("type"));
    await waitFor(() => {
      const names = (lastChart(/Net worth over time/)!.option as { series: Array<{ name: string }> }).series.map((s) => s.name);
      expect(names).toEqual(expect.arrayContaining(["Cash", "Credit", "Investments", "Net worth"]));
    });
  });
});

describe("Trajectory: projection (§12)", () => {
  it("states it's a projection from my own assumptions, and editing an assumption updates it live", async () => {
    const backend = installCoreBackend(historyFixture());
    const { data, today } = historyFixture();
    renderWithToken(<TrajectoryWindow />);
    await openTab("Projection");
    expect((await screen.findByTestId("disclaimer")).textContent).toBe("This is a projection from your own assumptions, not a prediction or financial advice.");

    await screen.findByText("Expected net worth in 30 years");
    const base = lastBody(backend, "trajectory.projection");
    expect(base).toMatchObject({ horizonYears: 30, dollars: "today" });
    const before = coreProjection(data, today, base).points.at(-1)!.totalCents;
    expect(await screen.findByText(money(before))).toBeTruthy();

    const field = await screen.findByLabelText("Investment return (% a year)");
    await userEvent.clear(field);
    await userEvent.type(field, "10");
    const after = coreProjection(data, today, { ...base, assumptions: { investmentReturnPct: 10 } }).points.at(-1)!.totalCents;
    expect(after).toBeGreaterThan(before);
    expect(await screen.findByText(money(after), {}, { timeout: 3000 })).toBeTruthy();
    expect(lastBody(backend, "trajectory.projection").assumptions).toEqual({ investmentReturnPct: 10 });
    // Not saved until I say so.
    expect(backend.callsTo("trajectory.setAssumptions")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Save assumptions…" }));
    expect(await screen.findByText("Update projection assumptions")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(backend.data.trajectoryAssumptions[0]!.assumptionsJson).toContain('"investmentReturnPct":10'));
  });

  it("toggles between today's dollars and future dollars", async () => {
    const backend = installCoreBackend(historyFixture());
    const { data, today } = historyFixture();
    renderWithToken(<TrajectoryWindow />);
    await openTab("Projection");
    await screen.findByText("Expected net worth in 30 years");
    const base = lastBody(backend, "trajectory.projection");
    const todays = coreProjection(data, today, { ...base, dollars: "today" }).points.at(-1)!.totalCents;
    const future = coreProjection(data, today, { ...base, dollars: "future" }).points.at(-1)!.totalCents;
    expect(future).toBeGreaterThan(todays);
    expect(await screen.findByText(money(todays))).toBeTruthy();
    expect(screen.getByText("in today's dollars")).toBeTruthy();
    await userEvent.click(screen.getByRole("switch"));
    expect(await screen.findByText(money(future))).toBeTruthy();
    expect(screen.getByText("in future dollars")).toBeTruthy();
    expect(lastBody(backend, "trajectory.projection").dollars).toBe("future");
  });

  it("switches the horizon and labels years with no phase as assumed to stay the same", async () => {
    const backend = installCoreBackend(historyFixture());
    renderWithToken(<TrajectoryWindow />);
    await openTab("Projection");
    await userEvent.click(await screen.findByRole("radio", { name: "40 years" }));
    await waitFor(() => expect(lastBody(backend, "trajectory.projection").horizonYears).toBe(40));
    expect(await screen.findByText("Expected net worth in 40 years")).toBeTruthy();
    expect(screen.getByText("assumed to stay the same")).toBeTruthy();
    expect(screen.getByText("2027–2066")).toBeTruthy();
  });

  it("previews a life phase live before it's saved", async () => {
    const backend = installCoreBackend(historyFixture());
    renderWithToken(<TrajectoryWindow />);
    await openTab("Projection");
    await userEvent.click(await screen.findByRole("radio", { name: "Life phases" }));
    await userEvent.click(screen.getByRole("button", { name: "Add life phase" }));
    await userEvent.type(screen.getByLabelText("Name"), "Grad school");
    await userEvent.type(screen.getByLabelText("Monthly income ($)"), "1500");
    await waitFor(() => expect(lastBody(backend, "trajectory.projection").phases).toEqual([expect.objectContaining({ name: "Grad school", fromYear: 2027, toYear: 2031, monthlyIncomeCents: 150000 })]), { timeout: 3000 });
    await waitFor(() => expect(screen.getByRole("list", { name: "What each year is based on" }).textContent).toContain("2027–2031: Grad school"));
    expect(backend.callsTo("trajectory.addLifePhase")).toEqual([]);
  });
});

describe("Trajectory: looking back drills down (§12)", () => {
  it("earning vs spending: an amount drills down to the figure behind it, by month and by year", async () => {
    installCoreBackend(historyFixture());
    const { data, today } = historyFixture();
    const dd = captureDrillDowns();
    renderWithToken(<TrajectoryWindow />);
    await openTab("Earning vs spending");
    const cashFlow = queryRegistry.get("spending.cashFlow")!;
    const figures = cashFlow.run(data as never, cashFlow.params.parse({ endMonth: "2026-10", months: 12 }), today).figures;
    const income = figures["2026-10.income"]!;
    await userEvent.click(await screen.findByRole("button", { name: `Income Oct 26: ${money(income.cents)}. Show transactions` }));
    await userEvent.click(screen.getByRole("radio", { name: "By year" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Spending 2026: .* Show transactions$/ }));
    dd.stop();
    expect(dd.seen).toEqual([
      { query: "spending.cashFlow", params: { endMonth: "2026-10", months: 12 }, figureId: "2026-10.income", label: "Income · Oct 26" },
      { query: "spending.byCategory", params: { from: "2026-01-01", to: "2026-12-31", level: "primary" }, figureId: "total", label: "Spending · 2026 · excluding transfers" },
    ]);
  });

  it("interest: the total interest drills down to the interest transactions", async () => {
    installCoreBackend(historyFixture());
    const dd = captureDrillDowns();
    renderWithToken(<TrajectoryWindow />);
    await openTab("Interest");
    await userEvent.click(await screen.findByRole("button", { name: "Total interest earned: $41.23. Show transactions" }));
    dd.stop();
    expect(dd.seen).toEqual([{ query: "trajectory.interest", params: {}, figureId: "interest.acc_hysa.total", label: "HYSA interest · all time" }]);
  });
});
