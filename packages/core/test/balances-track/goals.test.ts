import { describe, expect, it } from "vitest";
import {
  accountBar,
  allocate,
  allocateAll,
  balanceLookup,
  contributionStatus,
  deadlineStatus,
  explainGoalChanges,
  milestonesFor,
  newCelebrations,
  projectCompletion,
  projectionLabel,
  recentMonthlyRate,
  savedOn,
  whatIf,
} from "../../src/goals/index.ts";
import { addDays, eachDay } from "../../src/dates.ts";
import { Money } from "../../src/money.ts";
import { account, goal, prng, snap } from "./builders.ts";

const TODAY = "2026-11-18";
const bike = goal({ id: "bike", name: "Bike", targetCents: 120000, priority: 1 });
const mac = goal({ id: "mac", name: "MacBook", targetCents: 250000, priority: 2 });
const trip = goal({ id: "trip", name: "Trip", targetCents: 100000, priority: 3 });

describe("§11 allocation in priority order after the protected amount", () => {
  it("fills protected, then goal 1, goal 2…, rest unassigned (design.md example)", () => {
    const a = allocate(840000, 500000, [mac, bike]);
    expect(a.protectedCents).toBe(500000);
    expect(a.goals).toEqual([
      { goalId: "bike", allocatedCents: 120000, targetCents: 120000, complete: true },
      { goalId: "mac", allocatedCents: 220000, targetCents: 250000, complete: false },
    ]);
    expect(a.unassignedCents).toBe(0);
    expect(a.warning).toBeNull();
  });

  it("several goals on one account: leftover goes to unassigned", () => {
    const a = allocate(1000000, 500000, [bike, mac, trip]);
    expect(a.goals.map((g) => g.allocatedCents)).toEqual([120000, 250000, 100000]);
    expect(a.unassignedCents).toBe(30000);
  });

  it("withdrawals reduce the lowest-priority goals first", () => {
    const before = allocate(1000000, 500000, [bike, mac, trip]);
    const after = allocate(1000000 - 80000, 500000, [bike, mac, trip]);
    expect(after.unassignedCents).toBe(0);
    expect(after.goals.map((g) => g.allocatedCents)).toEqual([120000, 250000, 50000]);
    const after2 = allocate(1000000 - 200000, 500000, [bike, mac, trip]);
    expect(after2.goals.map((g) => g.allocatedCents)).toEqual([120000, 180000, 0]);
    expect(before.goals[2]!.allocatedCents).toBe(100000);
  });

  it("balance below protected: all goals $0 and an account warning", () => {
    const a = allocate(300000, 500000, [bike, mac]);
    expect(a.goals.every((g) => g.allocatedCents === 0)).toBe(true);
    expect(a.belowProtected).toBe(true);
    expect(a.protectedCents).toBe(300000);
    expect(a.warning).toMatch(/below the protected/);
    const neg = allocate(-5000, 0, [bike]);
    expect(neg.goals[0]!.allocatedCents).toBe(0);
    expect(neg.protectedCents).toBe(0);
  });

  it("invariant: allocations never exceed the balance (property)", () => {
    const rnd = prng(11);
    for (let i = 0; i < 500; i++) {
      const goals = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, k) =>
        goal({ id: `g${k}`, targetCents: Math.floor(rnd() * 500000), priority: Math.floor(rnd() * 4) }),
      );
      const balance = Math.floor((rnd() - 0.1) * 2000000);
      const a = allocate(balance, Math.floor(rnd() * 600000), goals);
      const total = a.protectedCents + Money.sum(a.goals.map((g) => g.allocatedCents)) + a.unassignedCents;
      expect(total).toBe(Math.max(balance, 0));
      for (const g of a.goals) {
        expect(g.allocatedCents).toBeGreaterThanOrEqual(0);
        expect(g.allocatedCents).toBeLessThanOrEqual(Math.max(g.targetCents, 0));
      }
    }
  });

  it("ignores archived goals and handles every account at once", () => {
    const hysa = account({ id: "acc_hysa", subtype: "savings", currentBalanceCents: 150000, protectedAmountCents: 0 });
    const archived = goal({ id: "old", targetCents: 999999, priority: 0, archivedAt: "2026-01-01T00:00:00.000Z" });
    const m = allocateAll([hysa], [archived, bike, mac]);
    expect(m.get("acc_hysa")!.goals.map((g) => [g.goalId, g.allocatedCents])).toEqual([
      ["bike", 120000],
      ["mac", 30000],
    ]);
  });

  it("account bar: protected, each goal with its target, unassigned", () => {
    const bar = accountBar(840000, 500000, [bike, mac]);
    expect(bar.segments).toEqual([
      { kind: "protected", cents: 500000, targetCents: 500000 },
      { kind: "goal", goalId: "bike", name: "Bike", cents: 120000, targetCents: 120000, complete: true, colorSlot: 0 },
      { kind: "goal", goalId: "mac", name: "MacBook", cents: 220000, targetCents: 250000, complete: false, colorSlot: 0 },
      { kind: "unassigned", cents: 0 },
    ]);
    expect(Money.sum(bar.segments.map((s) => s.cents))).toBe(bar.totalCents);
    expect(accountBar(100, 0, []).segments).toEqual([{ kind: "unassigned", cents: 100 }]);
  });
});

describe("§11 deadline math", () => {
  it("needed per month and behind amount", () => {
    const s = deadlineStatus({ targetCents: 300000, savedCents: 100000, deadline: "2027-06-01", today: TODAY, startDate: "2026-05-18" });
    // 195 days left = 6.41 months; 200000 / 6.41 = 31,200.x → rounded up.
    expect(s.daysLeft).toBe(195);
    expect(s.neededPerMonthCents).toBe(Math.ceil(200000 / (195 / (365.25 / 12))));
    // straight line: 184 of 379 days elapsed → 145,646 expected
    expect(s.onTrackCents).toBe(Math.round((300000 * 184) / 379));
    expect(s.aheadCents).toBe(100000 - s.onTrackCents);
    expect(s.label).toMatch(/^\$456 behind · need \$312\/month to hit Jun 1, 2027$/);
  });

  it("ahead, reached, under a month left, and overdue", () => {
    expect(deadlineStatus({ targetCents: 100000, savedCents: 90000, deadline: "2027-01-18", today: TODAY, startDate: "2026-11-01" }).aheadCents).toBeGreaterThan(0);
    const reached = deadlineStatus({ targetCents: 100000, savedCents: 100000, deadline: "2027-01-18", today: TODAY, startDate: "2026-11-01" });
    expect(reached.neededPerMonthCents).toBe(0);
    expect(reached.label).toMatch(/Reached/);
    expect(deadlineStatus({ targetCents: 100000, savedCents: 40000, deadline: "2026-12-01", today: TODAY, startDate: "2026-01-01" }).neededPerMonthCents).toBe(60000);
    const late = deadlineStatus({ targetCents: 100000, savedCents: 40000, deadline: "2026-11-01", today: TODAY, startDate: "2026-01-01" });
    expect(late.overdue).toBe(true);
    expect(late.label).toMatch(/has passed/);
  });
});

describe("§11 expected contribution: actual vs expected", () => {
  // Account grows by $10/day from 2026-07-01; one goal gets all of it.
  const days = eachDay("2026-07-01", TODAY);
  const snaps = days.map((d, i) => snap("acc_hysa", d, i * 1000));
  const balanceOn = balanceLookup(snaps, "acc_hysa", TODAY, (days.length - 1) * 1000);
  const g = goal({ id: "g", targetCents: 10_000_000, priority: 1 });
  const saved = (d: string) => savedOn(balanceOn, 0, [g], "g", d);

  it("current month and recent months", () => {
    const periods = contributionStatus({ expectedCents: 30000, period: "monthly", today: TODAY, saved });
    expect(periods.map((p) => [p.start, p.actualCents, p.met])).toEqual([
      ["2026-11-01", 18000, false],
      ["2026-10-01", 31000, true],
      ["2026-09-01", 30000, true],
      ["2026-08-01", 31000, true],
    ]);
    expect(periods[0]!.label).toBe("$180 of $300 this month");
  });

  it("weekly and yearly periods; unknown history is null, not zero", () => {
    const weekly = contributionStatus({ expectedCents: 7000, period: "weekly", today: TODAY, saved, recentPeriods: 1 });
    expect(weekly[0]).toMatchObject({ start: "2026-11-16", end: "2026-11-22", actualCents: 3000 });
    expect(weekly[1]).toMatchObject({ start: "2026-11-09", actualCents: 7000, met: true });
    const yearly = contributionStatus({ expectedCents: 1, period: "yearly", today: TODAY, saved, recentPeriods: 1 });
    expect(yearly[0]!.actualCents).toBeNull(); // no balance known on 2025-12-31
    expect(yearly[1]!.actualCents).toBeNull();
  });

  it("recent monthly rate", () => {
    expect(recentMonthlyRate(balanceOn, TODAY)).toBe(Math.round(1000 * (365.25 / 12)));
    expect(recentMonthlyRate(() => null, TODAY)).toBeNull();
  });
});

describe("§11 projected completion and what-if", () => {
  it("fills goals in order at the recent rate; earlier goals finishing speeds up later ones", () => {
    const p = projectCompletion({ balanceCents: 600000, protectedCents: 500000, goals: [bike, mac], monthlyRateCents: 50000, today: TODAY });
    // bike needs 20000 more → 0.4 months; mac needs 270000 more → 5.4 months
    expect(p[0]!.projectedDate).toBe(addDays(TODAY, Math.ceil(0.4 * (365.25 / 12))));
    expect(p[1]!.projectedDate).toBe(addDays(TODAY, Math.ceil(5.4 * (365.25 / 12))));
    const done = projectCompletion({ balanceCents: 2_000_000, protectedCents: 0, goals: [bike], monthlyRateCents: null, today: TODAY });
    expect(done[0]).toMatchObject({ alreadyComplete: true, projectedDate: TODAY });
    const stuck = projectCompletion({ balanceCents: 0, protectedCents: 0, goals: [bike], monthlyRateCents: -10, today: TODAY });
    expect(stuck[0]!.projectedDate).toBeNull();
  });

  it("shows both dates when the projection is later than the deadline", () => {
    expect(projectionLabel("2027-04-12", "2027-03-01")).toEqual({ showBoth: true, label: "Target Mar 1 · projected Apr 12" });
    expect(projectionLabel("2027-02-12", "2027-03-01")).toEqual({ showBoth: false, label: "Projected Feb 12" });
    expect(projectionLabel(null, null).label).toBe("No projected date");
  });

  it("what-if: a bigger contribution or a reorder moves the dates", () => {
    const base = { balanceCents: 0, protectedCents: 0, goals: [bike, mac], monthlyRateCents: 50000, today: TODAY };
    const more = whatIf(base, { contributionDeltaCents: 50000 });
    expect(more.shiftDays.bike).toBeLessThan(0);
    expect(more.shiftDays.mac).toBeLessThan(0);
    const reorder = whatIf(base, { order: ["mac", "bike"] });
    expect(reorder.shiftDays.mac).toBeLessThan(0);
    expect(reorder.shiftDays.bike).toBeGreaterThan(0);
    // The last goal's date only depends on the total, not the order.
    expect(reorder.scenario.find((s) => s.goalId === "bike")!.projectedDate).toBe(more.baseline.find((s) => s.goalId === "mac")!.projectedDate);
    expect(reorder.scenarioAllocation.goals.map((g) => g.goalId)).toEqual(["mac", "bike"]);
  });
});

describe("§11 loss explanations", () => {
  const state = (balanceCents: number, goals = [bike, mac, trip], protectedCents = 500000) => ({ balanceCents, protectedCents, goals });

  it("a withdrawal, with the transfer that caused it", () => {
    const changes = explainGoalChanges(state(1000000), state(970000 - 30000), {
      outflows: [{ transactionId: "tx1", date: "2026-11-03", amountCents: -60000 }],
    });
    const t = changes.find((c) => c.goalId === "trip")!;
    expect(t.changeCents).toBe(-30000);
    expect(t.losses).toEqual([
      { kind: "withdrawal", cents: -30000, message: "lost $300.00 after the Nov 3 transfer", goalIds: [], transactionIds: ["tx1"] },
    ]);
    expect(t.summary).toBe("Trip lost $300.00: lost $300.00 after the Nov 3 transfer");
    expect(changes.find((c) => c.goalId === "bike")!.losses).toEqual([]);
  });

  it("a higher-priority goal added", () => {
    const car = goal({ id: "car", name: "Car", targetCents: 50000, priority: 2 });
    const after = { ...state(970000), goals: [bike, car, { ...mac, priority: 3 }, { ...trip, priority: 4 }] };
    const changes = explainGoalChanges(state(970000), after);
    const t = changes.find((c) => c.goalId === "trip")!;
    expect(t.changeCents).toBe(-50000);
    expect(t.losses.map((l) => [l.kind, l.cents, l.goalIds])).toEqual([["higher_priority_added", -50000, ["car"]]]);
    expect(t.losses[0]!.message).toMatch(/"Car" was added/);
  });

  it("reordered priorities", () => {
    const after = { ...state(800000), goals: [{ ...trip, priority: 1 }, { ...bike, priority: 2 }, { ...mac, priority: 3 }] };
    const changes = explainGoalChanges(state(800000), after);
    const m = changes.find((c) => c.goalId === "mac")!;
    expect(m.losses.map((l) => [l.kind, l.goalIds])).toEqual([["reordered", ["trip"]]]);
    expect(m.changeCents).toBe(-100000);
    expect(changes.find((c) => c.goalId === "trip")!.gainedCents).toBe(100000);
  });

  it("several reasons at once always add up to the total change", () => {
    const rnd = prng(5);
    for (let i = 0; i < 200; i++) {
      const pool = [bike, mac, trip, goal({ id: "x", name: "X", targetCents: 70000, priority: 9 })];
      const pick = () => pool.filter(() => rnd() > 0.3).map((g) => ({ ...g, priority: Math.floor(rnd() * 5), targetCents: g.targetCents + Math.floor((rnd() - 0.5) * 50000) }));
      const before = { balanceCents: Math.floor(rnd() * 1500000), protectedCents: Math.floor(rnd() * 400000), goals: pick() };
      const after = { balanceCents: Math.floor(rnd() * 1500000), protectedCents: Math.floor(rnd() * 400000), goals: pick() };
      for (const c of explainGoalChanges(before, after)) {
        expect(c.changeCents).toBe(c.afterCents - c.beforeCents);
        expect(Money.sum(c.losses.map((l) => l.cents)) + c.gainedCents).toBe(c.changeCents);
        expect(c.afterCents).toBe(allocate(after.balanceCents, after.protectedCents, after.goals).goals.find((g) => g.goalId === c.goalId)!.allocatedCents);
      }
    }
  });
});

describe("§11 milestones", () => {
  it("every 25% or every $300, whichever is smaller; completion is its own milestone", () => {
    expect(milestonesFor(80000).map((m) => [m.cents, m.kind])).toEqual([
      [20000, "progress"],
      [40000, "progress"],
      [60000, "progress"],
      [80000, "completion"],
    ]);
    const big = milestonesFor(400000);
    expect(big[0]!.cents).toBe(30000);
    expect(big.at(-2)!.cents).toBe(390000);
    expect(big.at(-1)).toMatchObject({ cents: 400000, kind: "completion" });
    expect(big).toHaveLength(14);
    expect(milestonesFor(120000).map((m) => m.cents)).toEqual([30000, 60000, 90000, 120000]); // 25% = $300 exactly
  });

  it("each is celebrated once, even if the balance dips and recovers", () => {
    const g = { id: "g", targetCents: 80000 };
    const seen = new Set<number>();
    const first = newCelebrations(g, 45000, seen);
    expect(first.map((m) => m.cents)).toEqual([20000, 40000]);
    first.forEach((m) => seen.add(m.cents));
    expect(newCelebrations(g, 10000, seen)).toEqual([]); // dip
    expect(newCelebrations(g, 45000, seen)).toEqual([]); // recover: nothing new
    const done = newCelebrations(g, 80000, seen);
    expect(done.map((m) => [m.cents, m.kind])).toEqual([
      [60000, "progress"],
      [80000, "completion"],
    ]);
  });
});
