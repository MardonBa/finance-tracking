import { describe, expect, it } from "vitest";
import {
  accountKind,
  accountSeries,
  carryForwardSnapshots,
  chartDates,
  downsampleSnapshots,
  groupOfKind,
  historyStartFor,
  mergeRebuilt,
  netWorthChart,
  netWorthContributionFromPlaid,
  netWorthOn,
  rebuildHistory,
  replayForward,
  takeDailySnapshots,
} from "../../src/balances/index.ts";
import { addDays, dayOfWeek, eachDay } from "../../src/dates.ts";
import { Money } from "../../src/money.ts";
import { account, holding, prng, snap, tx } from "./builders.ts";

const TODAY = "2026-11-18";

describe("§5 snapshots: taking them", () => {
  const checking = account({ id: "chk", currentBalanceCents: 120000 });
  const card = account({ id: "card", type: "credit", subtype: "credit card", currentBalanceCents: -45012 });
  const loan = account({ id: "loan", type: "loan", subtype: "student", currentBalanceCents: -1500000 });
  const brokerage = account({ id: "brk", type: "investment", subtype: "brokerage", currentBalanceCents: 999 });
  const unknown = account({ id: "nobal", currentBalanceCents: null });

  it("saves one snapshot per account; credit cards and loans are negative contributions", () => {
    const snaps = takeDailySnapshots([checking, card, loan], [], TODAY);
    expect(snaps.map((s) => [s.accountId, s.balanceCents])).toEqual([
      ["chk", 120000],
      ["card", -45012],
      ["loan", -1500000],
    ]);
    expect(snaps.every((s) => s.date === TODAY && !s.isEstimated && !s.isCarriedForward && s.source === "plaid")).toBe(true);
  });

  it("converts Plaid's owed-is-positive debt balance into a negative contribution", () => {
    expect(netWorthContributionFromPlaid("credit", 45012)).toBe(-45012);
    expect(netWorthContributionFromPlaid("loan", 100)).toBe(-100);
    expect(netWorthContributionFromPlaid("credit", -500)).toBe(500); // overpaid card is an asset
    expect(netWorthContributionFromPlaid("checking", 100)).toBe(100);
    expect(Object.is(netWorthContributionFromPlaid("credit", 0), -0)).toBe(false);
  });

  it("snapshots investment accounts at the total value of their holdings", () => {
    const holdings = [holding("brk", "a", TODAY, 150000), holding("brk", "b", TODAY, 50025), holding("brk", "a", "2026-11-17", 1)];
    const [s] = takeDailySnapshots([brokerage], holdings, TODAY);
    expect(s!.balanceCents).toBe(200025);
    // With no holdings synced today it falls back to the reported total value.
    expect(takeDailySnapshots([brokerage], [], TODAY)[0]!.balanceCents).toBe(999);
  });

  it("never invents a zero for an account with no known balance", () => {
    expect(takeDailySnapshots([unknown], [], TODAY)).toEqual([]);
  });

  it("marks manual accounts' snapshots as manual", () => {
    const cash = account({ id: "cash", type: "other", subtype: null, isManual: true, currentBalanceCents: 4000 });
    expect(takeDailySnapshots([cash], [], TODAY)[0]!.source).toBe("manual");
    expect(accountKind(cash)).toBe("cash");
  });
});

describe("§5 net worth = sum of that day's snapshots", () => {
  it("adds only snapshots for that exact day", () => {
    const snaps = [snap("a", TODAY, 1000), snap("b", TODAY, -300), snap("a", "2026-11-17", 999999)];
    const nw = netWorthOn(snaps, TODAY);
    expect(nw.totalCents).toBe(700);
    expect(nw.parts.map((p) => p.snapshot)).toEqual([
      { accountId: "a", date: TODAY },
      { accountId: "b", date: TODAY },
    ]);
  });

  it("matches the sum for random data (property)", () => {
    const rnd = prng(7);
    for (let i = 0; i < 50; i++) {
      const snaps = Array.from({ length: 8 }, (_, k) => snap(`acc${k}`, TODAY, Math.round((rnd() - 0.4) * 1e7)));
      expect(netWorthOn(snaps, TODAY).totalCents).toBe(Money.sum(snaps.map((s) => s.balanceCents)));
    }
  });
});

describe("§5 downsampling", () => {
  const days = eachDay("2026-06-01", TODAY);
  const snaps = days.map((d, i) => snap("a", d, i * 100));

  it("keeps the last 90 days daily and one per week (end of week) before that", () => {
    const { kept, removed } = downsampleSnapshots(snaps, TODAY);
    const recent = kept.filter((s) => s.date >= addDays(TODAY, -90));
    expect(recent).toHaveLength(91);
    const old = kept.filter((s) => s.date < addDays(TODAY, -90));
    const weeks = new Set(old.map((s) => s.date));
    // Every kept old snapshot is a Sunday, except the partial week just before the cutoff.
    const cutoff = addDays(TODAY, -91);
    for (const d of weeks) if (d !== cutoff) expect(dayOfWeek(d), d).toBe(6);
    expect(kept.length + removed.length).toBe(snaps.length);
    expect(removed.every((r) => r.date < addDays(TODAY, -90))).toBe(true);
  });

  it("is idempotent", () => {
    const once = downsampleSnapshots(snaps, TODAY).kept;
    const twice = downsampleSnapshots(once, TODAY);
    expect(twice.removed).toEqual([]);
    expect(twice.kept).toEqual(once);
  });

  it("keeps the latest snapshot of a week when Sunday is missing", () => {
    const s = [snap("a", "2026-03-02", 1), snap("a", "2026-03-04", 2), snap("a", "2026-03-06", 3)]; // Mon, Wed, Fri
    const { kept } = downsampleSnapshots(s, TODAY);
    expect(kept.map((k) => k.date)).toEqual(["2026-03-06"]);
  });

  it("chart dates are weekly then daily", () => {
    const dates = chartDates("2026-07-01", TODAY, TODAY);
    expect(dates.at(-1)).toBe(TODAY);
    expect(dates.filter((d) => d >= addDays(TODAY, -90))).toHaveLength(91);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("§5 missed days: gaps or carried forward, never a fake zero", () => {
  const snaps = [snap("a", "2026-11-15", 5000), snap("a", "2026-11-17", 7000)];
  const dates = eachDay("2026-11-14", "2026-11-18");

  it("gap mode leaves null", () => {
    const series = accountSeries(snaps, "a", dates, TODAY, "gap");
    expect(series.map((p) => p.balanceCents)).toEqual([null, 5000, null, 7000, null]);
    expect(series[0]!.beforeHistory).toBe(true);
    expect(series[2]!.beforeHistory).toBe(false);
  });

  it("carry mode repeats the last known balance, flagged", () => {
    const series = accountSeries(snaps, "a", dates, TODAY, "carry");
    expect(series.map((p) => p.balanceCents)).toEqual([null, 5000, 5000, 7000, 7000]);
    expect(series.map((p) => p.isCarriedForward)).toEqual([false, false, true, false, true]);
    expect(series[2]!.snapshot).toEqual({ accountId: "a", date: "2026-11-15" });
  });

  it("carryForwardSnapshots fills a missed sync with flagged rows only where history exists", () => {
    const out = carryForwardSnapshots(snaps, ["a", "b"], TODAY);
    expect(out).toEqual([
      { accountId: "a", date: TODAY, balanceCents: 7000, source: "carried_forward", isEstimated: false, isCarriedForward: true },
    ]);
    expect(carryForwardSnapshots(snaps, ["a"], "2026-11-17")).toEqual([]);
  });
});

describe("§5 rebuilding past balances", () => {
  const chk = account({ id: "chk", currentBalanceCents: 152345, connectedOn: "2026-11-01" });

  function history(seed: number) {
    const rnd = prng(seed);
    const txs = [];
    for (const d of eachDay("2025-12-01", TODAY)) {
      const n = Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) txs.push(tx("chk", d, Math.round((rnd() - 0.55) * 30000)));
    }
    // Pending and removed rows never move the balance.
    txs.push(tx("chk", "2026-11-10", -99999, { pending: true }));
    txs.push(tx("chk", "2026-11-11", -88888, { removed: true }));
    txs.push(tx("other", "2026-11-11", -77777));
    return txs;
  }

  it("replaying the rebuilt history forward lands exactly on today's balance, to the cent", () => {
    for (const seed of [1, 2, 3, 42]) {
      const txs = history(seed);
      const r = rebuildHistory({ account: chk, transactions: txs, today: TODAY });
      if (!r.rebuilt) throw new Error("expected a rebuild");
      const first = r.snapshots[0]!;
      expect(replayForward(first.balanceCents, first.date, TODAY, txs, "chk")).toBe(152345);
      // And from every intermediate day too.
      for (const s of r.snapshots) expect(replayForward(s.balanceCents, s.date, TODAY, txs, "chk")).toBe(152345);
    }
  });

  it("marks rebuilt snapshots as estimated and covers every day back to the first transaction", () => {
    const txs = [tx("chk", "2026-11-10", -1000), tx("chk", "2026-11-12", 2500)];
    const r = rebuildHistory({ account: chk, transactions: txs, today: TODAY });
    if (!r.rebuilt) throw new Error("expected a rebuild");
    expect(r.startsOn).toBe("2026-11-09");
    expect(r.snapshots.map((s) => s.date)).toEqual(eachDay("2026-11-09", "2026-11-17"));
    expect(r.snapshots.every((s) => s.isEstimated && s.source === "rebuilt")).toBe(true);
    expect(r.snapshots.find((s) => s.date === "2026-11-11")!.balanceCents).toBe(152345 - 2500);
    expect(r.snapshots[0]!.balanceCents).toBe(152345 - 2500 + 1000);
    expect(r.transactionIdsByDate["2026-11-12"]).toEqual([txs[1]!.id]);
  });

  it("works for credit cards (debts negative)", () => {
    const card = account({ id: "card", type: "credit", subtype: "credit card", currentBalanceCents: -30000 });
    const txs = [tx("card", "2026-11-05", -10000), tx("card", "2026-11-15", 5000), tx("card", "2026-11-16", -25000)];
    const r = rebuildHistory({ account: card, transactions: txs, today: TODAY });
    if (!r.rebuilt) throw new Error("expected a rebuild");
    expect(r.snapshots[0]!.balanceCents).toBe(-30000 + 25000 - 5000 + 10000);
    expect(replayForward(r.snapshots[0]!.balanceCents, r.snapshots[0]!.date, TODAY, txs, "card")).toBe(-30000);
  });

  it("stops at 24 months", () => {
    const txs = [tx("chk", "2023-01-01", -1), tx("chk", "2026-01-01", -1)];
    const r = rebuildHistory({ account: chk, transactions: txs, today: TODAY });
    if (!r.rebuilt) throw new Error("expected a rebuild");
    expect(r.startsOn).toBe("2025-12-31");
  });

  it("investments and accounts with missing transactions start at their connection date, with a reason", () => {
    const brk = account({ id: "brk", type: "investment", subtype: "brokerage", currentBalanceCents: 100, connectedOn: "2026-10-01" });
    const r1 = rebuildHistory({ account: brk, transactions: [], today: TODAY });
    expect(r1).toMatchObject({ rebuilt: false, startsOn: "2026-10-01" });
    if (!r1.rebuilt) expect(r1.reason).toMatch(/market/);
    const r2 = rebuildHistory({ account: chk, transactions: history(1), today: TODAY, historyComplete: false });
    expect(r2).toMatchObject({ rebuilt: false, startsOn: "2026-11-01" });
    if (!r2.rebuilt) expect(r2.reason).toMatch(/missing/);
    const loan = account({ id: "loan", type: "loan", currentBalanceCents: -5 });
    expect(rebuildHistory({ account: loan, transactions: [], today: TODAY }).rebuilt).toBe(false);
    expect(rebuildHistory({ account: chk, transactions: [], today: TODAY }).rebuilt).toBe(false);
  });

  it("real snapshots win over rebuilt ones when merged", () => {
    const merged = mergeRebuilt([snap("chk", "2026-11-17", 1)], [snap("chk", "2026-11-17", 2, { isEstimated: true }), snap("chk", "2026-11-16", 3, { isEstimated: true })]);
    expect(merged.map((s) => s.balanceCents).sort()).toEqual([1, 3]);
  });
});

describe("§5 net worth chart", () => {
  const chk = account({ id: "chk", nickname: "Checking" });
  const sav = account({ id: "sav", subtype: "savings" });
  const card = account({ id: "card", type: "credit", subtype: "credit card" });
  const brk = account({ id: "brk", type: "investment", subtype: "brokerage", connectedOn: "2026-11-16" });
  const hidden = account({ id: "hid", hidden: true });
  const snaps = [
    snap("chk", "2026-11-16", 1000, { isEstimated: true, source: "rebuilt" }),
    snap("chk", "2026-11-17", 1100),
    snap("chk", TODAY, 1200),
    snap("sav", "2026-11-16", 5000),
    snap("sav", TODAY, 5100),
    snap("card", "2026-11-16", -300),
    snap("card", "2026-11-17", -400),
    snap("card", TODAY, -500),
    snap("brk", "2026-11-17", 9000),
    snap("brk", TODAY, 9100),
    snap("hid", TODAY, 77),
  ];
  const base = { accounts: [chk, sav, card, brk, hidden], snapshots: snaps, from: "2026-11-16", to: TODAY, today: TODAY } as const;

  it("stacks by account with debts below zero, and the hover shows date, each account and the total", () => {
    const c = netWorthChart({ ...base, grouping: "account", fill: "gap" });
    expect(c.series.map((s) => [s.key, s.side])).toEqual([
      ["chk", "asset"],
      ["sav", "asset"],
      ["card", "debt"],
      ["brk", "asset"],
    ]);
    const last = c.points.at(-1)!;
    expect(last.date).toBe(TODAY);
    expect(last.totalCents).toBe(1200 + 5100 - 500 + 9100);
    expect(last.breakdown.map((b) => [b.label, b.cents])).toEqual([
      ["Checking", 1200],
      ["sav", 5100],
      ["card", -500],
      ["brk", 9100],
    ]);
    expect(last.breakdown[0]!.snapshots).toEqual([{ accountId: "chk", date: TODAY }]);
    // Total equals the sum of that day's snapshots for the shown accounts.
    expect(last.totalCents).toBe(netWorthOn(snaps, TODAY, new Set(["chk", "sav", "card", "brk"])).totalCents);
  });

  it("marks gaps instead of zeros and estimated points", () => {
    const c = netWorthChart({ ...base, grouping: "account", fill: "gap" });
    const mid = c.points[1]!; // 11-17: sav missing
    expect(mid.incomplete).toBe(true);
    expect(mid.missingAccountIds).toEqual(["sav"]);
    expect(mid.breakdown.find((b) => b.key === "sav")!.cents).toBeNull();
    const first = c.points[0]!; // brk not started yet: not counted as missing
    expect(first.missingAccountIds).toEqual([]);
    expect(first.isEstimated).toBe(true);
    const carried = netWorthChart({ ...base, grouping: "account", fill: "carry" });
    expect(carried.points[1]!.breakdown.find((b) => b.key === "sav")).toMatchObject({ cents: 5000, isCarriedForward: true });
  });

  it("groups by type (cash, credit, investments, loans)", () => {
    const c = netWorthChart({ ...base, grouping: "type", fill: "gap" });
    expect(c.series.map((s) => [s.key, s.side, s.accountIds])).toEqual([
      ["cash", "asset", ["chk", "sav"]],
      ["credit", "debt", ["card"]],
      ["investments", "asset", ["brk"]],
    ]);
    expect(c.points.at(-1)!.breakdown.find((b) => b.key === "cash")!.cents).toBe(6300);
    expect(groupOfKind("loan")).toBe("loans");
  });

  it("says where each account's history starts and why", () => {
    const c = netWorthChart({ ...base, grouping: "account", fill: "gap" });
    const brkStart = c.historyStarts.find((h) => h.accountId === "brk")!;
    expect(brkStart.startsOn).toBe("2026-11-17");
    expect(brkStart.reason).toMatch(/Investment/);
    const chkStart = c.historyStarts.find((h) => h.accountId === "chk")!;
    expect(chkStart).toMatchObject({ startsOn: "2026-11-16", estimatedUntil: "2026-11-16" });
    expect(chkStart.reason).toMatch(/estimated/);
    expect(historyStartFor(sav, [], undefined).startsOn).toBeNull();
  });

  it("includes hidden accounts only when asked", () => {
    const c = netWorthChart({ ...base, grouping: "account", fill: "gap", includeHidden: true });
    expect(c.series.map((s) => s.key)).toContain("hid");
  });
});
