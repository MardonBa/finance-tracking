import { describe, expect, it } from "vitest";
import {
  ASSUMED_SAME_LABEL,
  DEFAULT_ASSUMPTIONS,
  contributionsVsGrowth,
  earningVsSpending,
  futureValue,
  interestVsPrincipal,
  monthlyRate,
  parsePhase,
  phaseOverlap,
  phaseRow,
  projectNetWorth,
  readAssumptions,
  rollUpToYears,
  startingParts,
  type ProjectionInput,
} from "../../src/trajectory/index.ts";
import { account, tx } from "./builders.ts";

const TODAY = "2026-11-18";

function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    today: TODAY,
    horizonYears: 30,
    dollars: "future",
    start: { cash: 0, hysa: 0, investments: 1_000_000, debts: 0 },
    partByAccount: { brk: "investments", hysa: "hysa", chk: "cash" },
    base: { ...DEFAULT_ASSUMPTIONS, contributions: [{ accountId: "brk", monthlyCents: 50_000 }] },
    usualMonthlyIncomeCents: 50_000,
    usualMonthlySpendingCents: 0,
    phases: [],
    ...over,
  };
}

describe("§12 projections match standard compound-interest formulas", () => {
  it("investments with monthly contributions: FV = P(1+r)^n + C((1+r)^n − 1)/r", () => {
    const r = projectNetWorth(input());
    const last = r.points.at(-1)!;
    const expected = futureValue(1_000_000, 50_000, monthlyRate(7), 360);
    expect(Math.abs(last.parts.investments - expected)).toBeLessThanOrEqual(1);
    expect(last.parts.cash).toBe(0); // income − spending − contributions = 0
    expect(r.points.map((p) => p.monthIndex)).toEqual(Array.from({ length: 31 }, (_, i) => i * 12));
  });

  it("monthly compounding at the effective rate equals annual compounding: P(1.07)^n", () => {
    const r = projectNetWorth(input({ base: { ...DEFAULT_ASSUMPTIONS, contributions: [] }, usualMonthlyIncomeCents: 0 }));
    for (const p of r.points) {
      const years = p.monthIndex / 12;
      expect(Math.abs(p.parts.investments - 1_000_000 * Math.pow(1.07, years))).toBeLessThanOrEqual(1);
    }
  });

  it("HYSA and cash parts compound at their own rates", () => {
    const r = projectNetWorth(
      input({
        start: { cash: 200_000, hysa: 500_000, investments: 0, debts: -100_000 },
        base: { ...DEFAULT_ASSUMPTIONS, hysaRatePct: 4.5, contributions: [{ accountId: "hysa", monthlyCents: 10_000 }] },
        usualMonthlyIncomeCents: 400_000,
        usualMonthlySpendingCents: 350_000,
        horizonYears: 20,
      }),
    );
    const last = r.points.at(-1)!;
    expect(Math.abs(last.parts.hysa - futureValue(500_000, 10_000, monthlyRate(4.5), 240))).toBeLessThanOrEqual(1);
    expect(last.parts.cash).toBe(200_000 + 40_000 * 240);
    expect(last.parts.debts).toBe(-100_000);
    expect(last.totalCents).toBe(last.parts.cash + last.parts.hysa + last.parts.investments + last.parts.debts);
  });

  it("a 1-year horizon has monthly points", () => {
    const r = projectNetWorth(input({ horizonYears: 1 }));
    expect(r.points).toHaveLength(13);
  });

  it("is deterministic", () => {
    expect(projectNetWorth(input())).toEqual(projectNetWorth(input()));
  });
});

describe("§12 range and today's dollars", () => {
  it("lower / higher use return ∓ 2 points and widen over time", () => {
    const r = projectNetWorth(input());
    expect(r.returnRange).toEqual({ lowPct: 5, expectedPct: 7, highPct: 9 });
    const last = r.points.at(-1)!;
    expect(Math.abs(last.lowCents - futureValue(1_000_000, 50_000, monthlyRate(5), 360))).toBeLessThanOrEqual(1);
    expect(Math.abs(last.highCents - futureValue(1_000_000, 50_000, monthlyRate(9), 360))).toBeLessThanOrEqual(1);
    const widths = r.points.map((p) => p.highCents - p.lowCents);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
  });

  it("today's dollars divide by (1 + inflation)^years", () => {
    const fut = projectNetWorth(input());
    const real = projectNetWorth(input({ dollars: "today" }));
    const f = fut.points.at(-1)!;
    const t = real.points.at(-1)!;
    expect(Math.abs(t.totalCents - f.totalCents / Math.pow(1.03, 30))).toBeLessThanOrEqual(2);
    expect(real.points[0]!.totalCents).toBe(fut.points[0]!.totalCents);
    expect(real.disclaimer).toMatch(/not a prediction/);
  });
});

describe("§12 life phases and 'assumed to stay the same'", () => {
  const phase = (fields: Partial<Parameters<typeof phaseRow>[1]> & { name: string; fromYear: number; toYear: number }) =>
    parsePhase(
      phaseRow(
        fields.name,
        { monthlyIncomeCents: null, monthlySpendingCents: null, savingsRatePct: null, investmentReturnPct: null, hysaRatePct: null, inflationPct: null, contributions: null, ...fields },
        "2026-11-18T00:00:00.000Z",
      ),
    );

  it("uses current habits first, then phases, and labels uncovered years", () => {
    const r = projectNetWorth(
      input({
        horizonYears: 20,
        phases: [
          phase({ name: "Early career", fromYear: 2027, toYear: 2030, monthlyIncomeCents: 600_000, savingsRatePct: 20 }),
          phase({ name: "Later", fromYear: 2031, toYear: 2035, monthlySpendingCents: 300_000, contributions: [{ accountId: "brk", monthlyCents: 100_000 }] }),
        ],
      }),
    );
    const byYear = new Map(r.years.map((y) => [y.year, y]));
    expect(byYear.get(2026)).toMatchObject({ kind: "current" });
    expect(byYear.get(2028)).toMatchObject({ kind: "phase", label: "Early career" });
    expect(byYear.get(2028)!.assumptions.monthlySpendingCents).toBe(480_000);
    expect(byYear.get(2033)!.assumptions).toMatchObject({ monthlyIncomeCents: 600_000, monthlySpendingCents: 300_000 });
    expect(byYear.get(2036)).toMatchObject({ kind: "assumed_same", label: ASSUMED_SAME_LABEL });
    expect(byYear.get(2036)!.assumptions).toEqual(byYear.get(2035)!.assumptions);
    expect(r.assumedSameFromYear).toBe(2036);
    expect(r.points.at(-1)!.basisLabel).toBe(ASSUMED_SAME_LABEL);
  });

  it("a phase changing the return switches compounding in that year", () => {
    const r = projectNetWorth(
      input({
        horizonYears: 20,
        base: { ...DEFAULT_ASSUMPTIONS, contributions: [] },
        usualMonthlyIncomeCents: 0,
        phases: [phase({ name: "Bear", fromYear: 2027, toYear: 2200, investmentReturnPct: 0 })],
      }),
    );
    // Only Dec 2026 grows at 7%; everything after stays flat.
    const expected = 1_000_000 * (1 + monthlyRate(7));
    expect(Math.abs(r.points.at(-1)!.parts.investments - expected)).toBeLessThanOrEqual(1);
  });

  it("detects overlapping phases", () => {
    expect(phaseOverlap([{ id: "a", name: "A", fromYear: 2027, toYear: 2030 }, { id: "b", name: "B", fromYear: 2030, toYear: 2031 }])).toMatch(/overlaps/);
    expect(phaseOverlap([{ id: "a", name: "A", fromYear: 2027, toYear: 2030 }, { id: "b", name: "B", fromYear: 2031, toYear: 2031 }])).toBeNull();
  });

  it("reads stored assumptions and falls back to defaults", () => {
    expect(readAssumptions([]).isDefault).toBe(true);
    expect(readAssumptions([{ id: "default", assumptionsJson: "not json", updatedAt: "" }]).isDefault).toBe(true);
    const stored = { ...DEFAULT_ASSUMPTIONS, investmentReturnPct: 6 };
    expect(readAssumptions([{ id: "default", assumptionsJson: JSON.stringify(stored), updatedAt: "" }]).assumptions.investmentReturnPct).toBe(6);
  });

  it("starting parts come from current balances by account kind", () => {
    const { start, partByAccount } = startingParts([
      account({ id: "chk", currentBalanceCents: 100 }),
      account({ id: "hysa", subtype: "savings", currentBalanceCents: 200 }),
      account({ id: "brk", type: "investment", currentBalanceCents: 300 }),
      account({ id: "card", type: "credit", currentBalanceCents: -50 }),
    ]);
    expect(start).toEqual({ cash: 100, hysa: 200, investments: 300, debts: -50 });
    expect(partByAccount.card).toBe("debts");
  });
});

describe("§12 looking back", () => {
  it("earning vs spending with savings rate and spending share, by month and year", () => {
    const months = [
      { period: "2026-01", incomeCents: 500_000, spendingCents: 400_000 },
      { period: "2026-02", incomeCents: 500_000, spendingCents: 550_000 },
      { period: "2026-03", incomeCents: 0, spendingCents: 10_000 },
      { period: "2025-12", incomeCents: 100, spendingCents: 50 },
    ];
    const rows = earningVsSpending(months);
    expect(rows[0]).toMatchObject({ savedCents: 100_000, savingsRate: 0.2, spendingShare: 0.8 });
    expect(rows[1]!.savingsRate).toBeCloseTo(-0.1);
    expect(rows[2]).toMatchObject({ savingsRate: null, spendingShare: null });
    expect(earningVsSpending(rollUpToYears(months))).toEqual([
      { period: "2025", incomeCents: 100, spendingCents: 50, savedCents: 50, savingsRate: 0.5, spendingShare: 0.5 },
      { period: "2026", incomeCents: 1_000_000, spendingCents: 960_000, savedCents: 40_000, savingsRate: 0.04, spendingShare: 0.96 },
    ]);
  });

  it("investments: contributions vs growth from when history starts", () => {
    const r = contributionsVsGrowth(
      [
        { date: "2026-09-01", valueCents: 1_000_000 },
        { date: "2026-10-01", valueCents: 1_120_000 },
        { date: "2026-11-01", valueCents: 1_090_000 },
      ],
      [
        { date: "2026-08-15", cents: 999_999, id: "before-history" },
        { date: "2026-09-15", cents: 100_000, id: "in" },
        { date: "2026-10-20", cents: -50_000, id: "out" },
      ],
    );
    expect(r.historyStartsOn).toBe("2026-09-01");
    expect(r.points.map((p) => [p.contributedCents, p.growthCents])).toEqual([
      [1_000_000, 0],
      [1_100_000, 20_000],
      [1_050_000, 40_000],
    ]);
    expect(contributionsVsGrowth([], []).points).toEqual([]);
  });

  it("interest vs principal: cumulative principal, total interest, interest per month and year", () => {
    const interest = { plaidCategoryDetailed: "INCOME_INTEREST_EARNED" };
    const txs = [
      tx("hysa", "2025-12-05", 100_000, { id: "d1" }),
      tx("hysa", "2025-12-31", 300, { id: "i1", ...interest }),
      tx("hysa", "2026-01-31", 650, { id: "i2", ...interest }),
      tx("hysa", "2026-02-10", -20_000, { id: "w1" }),
      tx("hysa", "2026-02-28", 600, { id: "i3", ...interest }),
      tx("hysa", "2026-02-28", 999, { id: "pending", pending: true, ...interest }),
      tx("chk", "2026-02-28", 5, { id: "other", ...interest }),
    ];
    const r = interestVsPrincipal({ accountId: "hysa", transactions: txs, startingBalanceCents: 50_000 });
    expect(r.months.map((m) => [m.month, m.interestCents, m.principalCents, m.totalInterestCents])).toEqual([
      ["2025-12", 300, 150_000, 300],
      ["2026-01", 650, 150_000, 950],
      ["2026-02", 600, 130_000, 1_550],
    ]);
    expect(r.years).toEqual([
      { year: "2025", interestCents: 300, interestTransactionIds: ["i1"] },
      { year: "2026", interestCents: 1_250, interestTransactionIds: ["i2", "i3"] },
    ]);
    // An override recategorising a deposit as interest is respected.
    const r2 = interestVsPrincipal({
      accountId: "hysa",
      transactions: txs,
      startingBalanceCents: 50_000,
      overrides: [{ transactionId: "d1", category: "INCOME_INTEREST_EARNED", bucket: null, necessity: null, note: null, confirmedAt: null, updatedAt: "" }],
    });
    expect(r2.totalInterestCents).toBe(101_550);
  });
});
