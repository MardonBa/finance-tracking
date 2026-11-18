/** Daily snapshot upkeep (§5) and the accounts.list fields the Overview needs (§4, §13). */
import { describe, expect, it } from "vitest";
import { planSnapshotMaintenance } from "../../src/balances/maintenance.ts";
import { addDays, eachDay } from "../../src/dates.ts";
import { queryRegistry } from "../../src/queries/index.ts";
import { basicFixture } from "../../fixtures/index.ts";
import { account, snap, tx } from "../balances-track/builders.ts";

const TODAY = "2026-11-18";

describe("planSnapshotMaintenance", () => {
  it("rebuilds a newly connected checking account once its import is complete, marked estimated", () => {
    const acc = account({ id: "chk", currentBalanceCents: 10000, connectedOn: TODAY });
    const txs = [tx("chk", "2026-11-10", -2000), tx("chk", "2026-11-15", 5000)];
    const snapshots = [snap("chk", TODAY, 10000)];

    const waiting = planSnapshotMaintenance({ accounts: [acc], transactions: txs, snapshots, today: TODAY, historyCompleteAccountIds: new Set() });
    expect(waiting.rebuilt).toEqual([]);
    expect(waiting.upserts).toEqual([]);

    const plan = planSnapshotMaintenance({ accounts: [acc], transactions: txs, snapshots, today: TODAY, historyCompleteAccountIds: new Set(["chk"]) });
    expect(plan.rebuilt).toEqual(["chk"]);
    const byDate = Object.fromEntries(plan.upserts.map((s) => [s.date, s]));
    expect(byDate["2026-11-17"]).toMatchObject({ balanceCents: 10000, isEstimated: true, source: "rebuilt" });
    expect(byDate["2026-11-14"]!.balanceCents).toBe(5000);
    expect(byDate["2026-11-09"]!.balanceCents).toBe(7000);
    // The real snapshot for today is never overwritten.
    expect(byDate[TODAY]).toBeUndefined();
  });

  it("does not rebuild twice, nor investments", () => {
    const chk = account({ id: "chk", currentBalanceCents: 10000 });
    const inv = account({ id: "inv", type: "investment", subtype: "brokerage", currentBalanceCents: 10000 });
    const txs = [tx("chk", "2026-11-10", -2000), tx("inv", "2026-11-10", -2000)];
    const plan = planSnapshotMaintenance({
      accounts: [chk, inv],
      transactions: txs,
      snapshots: [snap("chk", "2026-11-17", 1, { isEstimated: true, source: "rebuilt" })],
      today: TODAY,
      historyCompleteAccountIds: new Set(["chk", "inv"]),
    });
    expect(plan.rebuilt).toEqual([]);
    expect(plan.upserts).toEqual([]);
  });

  it("downsamples snapshots older than 90 days to one per week", () => {
    const acc = account({ id: "chk" });
    const days = eachDay(addDays(TODAY, -130), TODAY);
    const snapshots = days.map((d, i) => snap("chk", d, i));
    const plan = planSnapshotMaintenance({ accounts: [acc], transactions: [], snapshots, today: TODAY, historyCompleteAccountIds: new Set() });
    const old = days.filter((d) => d < addDays(TODAY, -90));
    expect(plan.deletes.length).toBeGreaterThan(old.length - 8);
    expect(plan.deletes.length).toBeLessThan(old.length);
    expect(plan.deletes.every((k) => k.date < addDays(TODAY, -90))).toBe(true);
    expect(plan.upserts).toEqual([]);
  });

  it("derives a manual account's balance and every snapshot from its transactions", () => {
    const cash = account({ id: "cash", isManual: true, type: "other", subtype: null, kindOverride: "cash", itemId: null, connectedOn: "2026-11-01", currentBalanceCents: 999 });
    const txs = [tx("cash", "2026-11-01", 4000, { isManual: true }), tx("cash", "2026-11-05", -1500, { isManual: true }), tx("cash", "2026-11-06", -100, { pending: true })];
    const plan = planSnapshotMaintenance({
      accounts: [cash],
      transactions: txs,
      snapshots: [snap("cash", "2026-11-04", 12345, { source: "manual" }), snap("cash", "2026-10-01", 1, { source: "manual" })],
      today: TODAY,
      historyCompleteAccountIds: new Set(),
    });
    expect(plan.balances).toEqual([{ accountId: "cash", currentBalanceCents: 2500 }]);
    const byDate = Object.fromEntries(plan.upserts.map((s) => [s.date, s.balanceCents]));
    expect(byDate["2026-11-04"]).toBe(4000);
    expect(byDate["2026-11-05"]).toBe(2500);
    expect(byDate[TODAY]).toBe(2500);
    // A day before the account existed no longer carries a balance.
    expect(plan.deletes).toEqual([{ accountId: "cash", date: "2026-10-01" }]);
  });

  it("is stable: applying a plan then planning again changes nothing", () => {
    const acc = account({ id: "chk", currentBalanceCents: 10000 });
    const cash = account({ id: "cash", isManual: true, itemId: null, kindOverride: "cash", connectedOn: "2026-03-01", currentBalanceCents: 4000 });
    const txs = [tx("chk", "2026-05-10", -2000), tx("cash", "2026-03-01", 4000, { isManual: true })];
    const input = { accounts: [acc, cash], transactions: txs, snapshots: [snap("chk", TODAY, 10000)], today: TODAY, historyCompleteAccountIds: new Set(["chk"]) };
    const first = planSnapshotMaintenance(input);
    const deleted = new Set(first.deletes.map((k) => `${k.accountId}@${k.date}`));
    const after = new Map(input.snapshots.filter((s) => !deleted.has(`${s.accountId}@${s.date}`)).map((s) => [`${s.accountId}@${s.date}`, s]));
    for (const s of first.upserts) after.set(`${s.accountId}@${s.date}`, s);
    const second = planSnapshotMaintenance({ ...input, snapshots: [...after.values()] });
    expect(second.upserts).toEqual([]);
    expect(second.deletes).toEqual([]);
    expect(second.rebuilt).toEqual([]);
  });
});

describe("accounts.list", () => {
  it("includes each account's connection (itemId), null for manual accounts", () => {
    const { data, today } = basicFixture();
    const q = queryRegistry.get("accounts.list")!;
    const r = q.run(data as never, q.params.parse({}), today) as { value: { accounts: Array<{ id: string; itemId: string | null; isManual: boolean }> } };
    for (const a of r.value.accounts) {
      const src = data.accounts.find((x) => x.id === a.id)!;
      expect(a.itemId).toBe(src.itemId);
      if (a.isManual) expect(a.itemId).toBeNull();
    }
  });
});
