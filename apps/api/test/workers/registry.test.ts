import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryRegistry } from "@ft/core";
import { basicFixture } from "@ft/core/fixtures";
import { addCredential, loadBasicFixture, request } from "./helpers.ts";
import { loadSlices, getDb } from "../../src/db/data.ts";

describe("registry routes", () => {
  beforeEach(async () => {
    await addCredential();
    await loadBasicFixture();
  });

  it("loads every CoreData slice back exactly as stored (and never the access token)", async () => {
    const { data } = basicFixture();
    const loaded = await loadSlices(getDb(env.DB), ["items", "transactions", "splits", "holdings", "accounts"]);
    expect(loaded.items).toEqual(data.items);
    expect(JSON.stringify(loaded.items)).not.toContain("test-ciphertext");
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect([...loaded.transactions].sort(byId)).toEqual([...data.transactions].sort(byId));
    expect(loaded.holdings).toEqual(data.holdings);
  });

  it("serves a query over POST and GET with the same result the core function gives", async () => {
    const { data, today } = basicFixture();
    const params = { from: "2026-10-01", to: "2026-10-31", accountId: "acc_card" };
    const expected = queryRegistry.get("example.sumTransactions")!.run(data, params, today);

    const post = await request("/q/example.sumTransactions", { method: "POST", body: JSON.stringify(params) });
    expect(post.status).toBe(200);
    const body = (await post.json()) as typeof expected;
    expect(body.value).toEqual(expected.value);
    expect(new Set(body.figures.total!.contributions.map((c) => c.transactionId))).toEqual(
      new Set(expected.figures.total!.contributions.map((c) => c.transactionId)),
    );

    const get = await request(`/q/example.sumTransactions?params=${encodeURIComponent(JSON.stringify(params))}`);
    expect(((await get.json()) as typeof expected).value).toEqual(expected.value);
  });

  it("rejects bad params and unknown names", async () => {
    const bad = await request("/q/example.sumTransactions", { method: "POST", body: JSON.stringify({ from: "x" }) });
    expect(bad.status).toBe(400);
    const missing = await request("/q/nope.nothing", { method: "POST", body: "{}" });
    expect(missing.status).toBe(404);
  });

  it("previews, applies, logs and undoes an action", async () => {
    const input = { transactionId: "tx_poker_in", note: "Friday game" };
    const note = async () =>
      (await env.DB.prepare("SELECT note FROM transaction_overrides WHERE transaction_id = ?").bind("tx_poker_in").first<{ note: string }>())?.note;

    const preview = await request("/a/example.setTransactionNote/preview", { method: "POST", body: JSON.stringify(input) });
    expect(((await preview.json()) as { preview: { changes: unknown[] } }).preview.changes).toEqual([
      { label: "Note", before: "Thursday game buy-ins", after: "Friday game" },
    ]);
    expect(await note()).toBe("Thursday game buy-ins"); // preview changes nothing

    const applied = await request("/a/example.setTransactionNote", { method: "POST", body: JSON.stringify(input) });
    expect(applied.status).toBe(200);
    const { logId } = (await applied.json()) as { logId: string };
    expect(await note()).toBe("Friday game");

    const log = (await (await request("/actions")).json()) as { actions: Array<{ id: string; source: string; undoneAt: string | null }> };
    expect(log.actions[0]).toMatchObject({ id: logId, source: "user", undoneAt: null });

    const undo = await request(`/actions/${logId}/undo`, { method: "POST" });
    expect(undo.status).toBe(200);
    expect(await note()).toBe("Thursday game buy-ins");

    const again = await request(`/actions/${logId}/undo`, { method: "POST" });
    expect(again.status).toBe(400);
  });

  it("undoing an action that created a row deletes it", async () => {
    const res = await request("/a/example.setTransactionNote", {
      method: "POST",
      body: JSON.stringify({ transactionId: "tx_paycheck", note: "October pay" }),
    });
    const { logId } = (await res.json()) as { logId: string };
    const count = async () =>
      (await env.DB.prepare("SELECT count(*) AS n FROM transaction_overrides WHERE transaction_id = 'tx_paycheck'").first<{ n: number }>())?.n;
    expect(await count()).toBe(1);
    await request(`/actions/${logId}/undo`, { method: "POST" });
    expect(await count()).toBe(0);
  });

  it("refuses invalid action input without writing anything", async () => {
    const res = await request("/a/example.setTransactionNote", { method: "POST", body: JSON.stringify({ transactionId: "nope", note: "x" }) });
    expect(res.status).toBe(400);
    const log = await env.DB.prepare("SELECT count(*) AS n FROM action_log").first<{ n: number }>();
    expect(log?.n).toBe(0);
  });
});
