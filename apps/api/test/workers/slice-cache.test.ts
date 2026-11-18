/**
 * The slice cache (db/data.ts): tables are re-read from D1 only when their
 * slice_versions token changed, which SQLite triggers do on every write
 * (migration 0004). Saves D1 row reads without ever serving stale data.
 */
import { env } from "cloudflare:workers";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { clearSliceCacheForTests, sliceReads } from "../../src/db/data.ts";
import { TABLES } from "../../src/db/tables.ts";
import { addCredential, loadBasicFixture, request, rows } from "./helpers.ts";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const reads = (slice: string) => sliceReads.get(slice as never) ?? 0;
const spending = async () =>
  (await (await request("/q/spending.byCategory", { method: "POST", body: JSON.stringify({ ...OCT, level: "primary" }) })).json()) as {
    figures: Record<string, { cents: number }>;
  };

beforeEach(async () => {
  await addCredential();
  await loadBasicFixture();
  clearSliceCacheForTests();
});

describe("slice cache", () => {
  it("a repeated query doesn't re-read its tables", async () => {
    const first = await spending();
    const after1 = reads("transactions");
    expect(after1).toBe(1);
    const second = await spending();
    expect(second).toEqual(first);
    expect(reads("transactions")).toBe(after1);
  });

  it("an action re-reads only the tables it changed, and the answer reflects it", async () => {
    await spending();
    const tx = reads("transactions");
    const ov = reads("overrides");
    const res = await request("/a/transactions.setNote", { method: "POST", body: JSON.stringify({ transactionId: "tx_poker_in", note: "cached?" }) });
    expect(res.status).toBe(200);
    const list = (await (await request("/q/transactions.list", { method: "POST", body: JSON.stringify({ ...OCT, text: "cached?" }) })).json()) as {
      value: unknown;
    };
    expect(JSON.stringify(list.value)).toContain("cached?");
    expect(reads("overrides")).toBeGreaterThan(ov); // the note lives in transaction_overrides
    expect(reads("transactions")).toBe(tx); // transactions didn't change
  });

  it("a write that bypasses the app (raw SQL, e.g. sync or a restore) is seen on the next query", async () => {
    const before = await spending();
    await env.DB.prepare("UPDATE transactions SET amount_cents = amount_cents * 2 WHERE amount_cents < 0").run();
    const after = await spending();
    expect(after).not.toEqual(before);
    expect(reads("transactions")).toBe(2);
  });

  it("queries say which slices they read, and actions and undo say which slices they changed", async () => {
    const q = (await (await request("/q/goals.accountBars", { method: "POST", body: "{}" })).json()) as { needs: string[] };
    expect(q.needs).toEqual(["accounts", "goals", "balanceSnapshots"]);
    const applied = (await (
      await request("/a/transactions.setNote", { method: "POST", body: JSON.stringify({ transactionId: "tx_poker_in", note: "x" }) })
    ).json()) as { logId: string; changed: string[] };
    expect(applied.changed).toEqual(["overrides"]);
    const undone = (await (await request(`/actions/${applied.logId}/undo`, { method: "POST" })).json()) as { changed: string[] };
    expect(undone.changed).toEqual(["overrides"]);
  });

  it("every data table has insert, update and delete triggers and a version row", async () => {
    const triggers = new Set((await rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map((r) => r.name));
    const versions = new Set((await rows<{ slice: string }>("SELECT slice FROM slice_versions")).map((r) => r.slice));
    for (const [key, table] of Object.entries(TABLES)) {
      const name = getTableName(table as never);
      for (const op of ["insert", "update", "delete"]) expect(triggers.has(`sv_${name}_${op}`), `sv_${name}_${op}`).toBe(true);
      expect(versions.has(key), key).toBe(true);
    }
  });
});
