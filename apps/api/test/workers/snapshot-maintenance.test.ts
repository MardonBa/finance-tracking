/**
 * syncHooks.afterDailySnapshots (§5): after the daily snapshots are saved,
 * newly connected accounts get estimated history, manual accounts follow
 * their transactions, and snapshots older than 90 days become weekly.
 */
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, eachDay } from "@ft/core";
import { setDeps } from "../../src/deps.ts";
import { saveDailySnapshots } from "../../src/sync/snapshots.ts";
import { maintainSnapshots } from "../../src/sync/balanceMaintenance.ts";
import { count, loadBasicFixture, rows } from "./helpers.ts";

const TODAY = "2026-10-31";

beforeEach(async () => {
  await loadBasicFixture();
  setDeps({ now: () => Date.parse(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => setDeps({}));

describe("afterDailySnapshots", () => {
  it("rebuilds estimated history only once the bank's history import is complete", async () => {
    await saveDailySnapshots(env, TODAY);
    expect(await count("balance_snapshots", "is_estimated = 1")).toBe(0);

    await env.DB.prepare("UPDATE plaid_items SET transactions_update_status = 'HISTORICAL_UPDATE_COMPLETE'").run();
    await saveDailySnapshots(env, TODAY);
    const est = await rows<{ account_id: string }>("SELECT DISTINCT account_id FROM balance_snapshots WHERE is_estimated = 1 ORDER BY account_id");
    // Checking/savings/credit are rebuilt from transactions; the brokerage never is; the manual account is exact, not estimated.
    expect(est.map((r) => r.account_id).filter((id) => id === "acc_brokerage" || id === "acc_cash")).toEqual([]);
    expect(est.length).toBeGreaterThan(0);
    // Today's real snapshot is untouched.
    const todayRow = await rows<{ is_estimated: number; source: string }>("SELECT is_estimated, source FROM balance_snapshots WHERE account_id = 'acc_checking' AND date = ?1", TODAY);
    expect(todayRow[0]).toMatchObject({ is_estimated: 0, source: "plaid" });

    // Running again writes nothing new.
    const again = await maintainSnapshots(env, TODAY);
    expect(again).toMatchObject({ upserted: 0, deleted: 0, rebuilt: [] });
  });

  it("downsamples snapshots older than 90 days to one per week", async () => {
    const days = eachDay(addDays(TODAY, -140), addDays(TODAY, -1));
    const stmt = env.DB.prepare("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance_cents, source, is_estimated, is_carried_forward) VALUES ('acc_brokerage', ?1, 100, 'plaid', 0, 0)");
    await env.DB.batch(days.map((d) => stmt.bind(d)));
    await saveDailySnapshots(env, TODAY);
    const cutoff = addDays(TODAY, -90);
    const old = await count("balance_snapshots", "account_id = 'acc_brokerage' AND date < ?1", cutoff);
    expect(old).toBeLessThanOrEqual(8);
    expect(old).toBeGreaterThanOrEqual(6);
    expect(await count("balance_snapshots", "account_id = 'acc_brokerage' AND date >= ?1", cutoff)).toBe(91);
  });

  it("keeps a manual account's balance and snapshots equal to its transactions", async () => {
    // Someone (or an old build) left a stale balance and a wrong snapshot.
    await env.DB.prepare("UPDATE accounts SET current_balance_cents = 1 WHERE id = 'acc_cash'").run();
    await env.DB.prepare("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance_cents, source, is_estimated, is_carried_forward) VALUES ('acc_cash', ?1, 777, 'manual', 0, 0)").bind(addDays(TODAY, -3)).run();
    await saveDailySnapshots(env, TODAY);
    const sum = (await rows<{ s: number }>("SELECT coalesce(sum(amount_cents), 0) AS s FROM transactions WHERE account_id = 'acc_cash' AND pending = 0 AND removed = 0"))[0]!.s;
    const acc = await rows<{ current_balance_cents: number }>("SELECT current_balance_cents FROM accounts WHERE id = 'acc_cash'");
    expect(acc[0]!.current_balance_cents).toBe(sum);
    const snap = await rows<{ balance_cents: number }>("SELECT balance_cents FROM balance_snapshots WHERE account_id = 'acc_cash' AND date = ?1", TODAY);
    expect(snap[0]!.balance_cents).toBe(sum);
    const fixed = await rows<{ balance_cents: number }>("SELECT balance_cents FROM balance_snapshots WHERE account_id = 'acc_cash' AND date = ?1", addDays(TODAY, -3));
    expect(fixed[0]!.balance_cents).not.toBe(777);
  });
});
