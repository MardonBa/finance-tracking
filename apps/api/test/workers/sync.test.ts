import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDeps } from "../../src/deps.ts";
import { acquireSyncLock, syncAllItems, syncItem } from "../../src/sync/run.ts";
import { saveDailySnapshots } from "../../src/sync/snapshots.ts";
import { runScheduled } from "../../src/index.ts";
import { addCredential, count, insertItem, request, rows } from "./helpers.ts";
import { FakePlaid, bankAccounts, type FakeItem, type FakeTx } from "./fake-plaid.ts";

let plaid: FakePlaid;
let restore: () => void;

beforeEach(async () => {
  await addCredential();
  plaid = new FakePlaid();
  restore = setDeps({ plaidFetch: plaid.fetch });
});
afterEach(() => restore());

const tx = (id: string, amount: number, extra: Partial<FakeTx> = {}): FakeTx => ({ transaction_id: id, account_id: "a-checking", amount, date: "2026-11-10", ...extra });

async function connected(partial: Partial<FakeItem> = {}) {
  const fake = plaid.addItem({ accounts: bankAccounts(), ...partial });
  const itemId = await insertItem(fake);
  return { fake, itemId };
}

const txRows = () => rows<{ id: string; plaid_transaction_id: string; amount_cents: number; pending: number; removed: number }>(
  "SELECT id, plaid_transaction_id, amount_cents, pending, removed FROM transactions ORDER BY plaid_transaction_id",
);

describe("/transactions/sync (§4)", () => {
  it("imports every page, stores trimmed rows in our sign convention, and saves the cursor", async () => {
    const { itemId } = await connected({
      pages: [{ added: [tx("t1", 12.34), tx("t2", -2500, { name: "PAYROLL" })] }, { added: [tx("t3", 410.25, { account_id: "a-card" })] }],
    });
    const out = await syncItem(env, itemId, { trigger: "initial" });
    expect(out).toMatchObject({ status: "up_to_date", added: 3 });
    expect(plaid.callsTo("/transactions/sync")).toHaveLength(2);
    expect((await txRows()).map((r) => [r.plaid_transaction_id, r.amount_cents])).toEqual([
      ["t1", -1234],
      ["t2", 250000],
      ["t3", -41025],
    ]);
    const all = JSON.stringify(await rows("SELECT * FROM transactions"));
    expect(all).not.toContain("Secret St"); // location never stored
    expect(all).not.toContain("Someone"); // payment meta never stored
    const [item] = await rows<{ transactions_cursor: string; transactions_update_status: string; last_synced_at: string }>("SELECT * FROM plaid_items");
    expect(item).toMatchObject({ transactions_cursor: "c2", transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" });
    expect(item!.last_synced_at).toBeTruthy();
    // Every sync request asks for the original description and 24 months.
    expect(plaid.callsTo("/transactions/sync")[0]!.body.options).toEqual({ include_original_description: true, days_requested: 730 });
  });

  it("is safe to repeat: a second sync and a replayed page create no duplicates", async () => {
    const { itemId, fake } = await connected({ pages: [{ added: [tx("t1", 10), tx("t2", 20)] }] });
    await syncItem(env, itemId, { trigger: "cron" });
    await syncItem(env, itemId, { trigger: "cron" });
    expect(await count("transactions")).toBe(2);

    // Replay the same page from the start (cursor lost / crash before saving it).
    await env.DB.prepare("UPDATE plaid_items SET transactions_cursor = NULL").run();
    fake.pages.push({ modified: [tx("t1", 11)] });
    await syncItem(env, itemId, { trigger: "webhook" });
    expect(await count("transactions")).toBe(2);
    expect((await txRows())[0]!.amount_cents).toBe(-1100);
  });

  it("locks per item: an overlapping run does nothing", async () => {
    const { itemId } = await connected({ pages: [{ added: [tx("t1", 10)] }] });
    const held = await acquireSyncLock(env, itemId, "cron");
    expect(held).toBeTruthy();
    expect(await syncItem(env, itemId, { trigger: "webhook" })).toEqual({ itemId, status: "already_running" });
    expect(plaid.callsTo("/transactions/sync")).toHaveLength(0);
    // A stale lock (Worker evicted mid-run) does not block forever.
    await env.DB.prepare("UPDATE sync_runs SET started_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(held).run();
    expect((await syncItem(env, itemId, { trigger: "webhook" })).status).toBe("up_to_date");
  });

  it("restarts pagination from the original cursor when Plaid reports a mutation mid-pagination", async () => {
    const { itemId } = await connected({ pages: [{ added: [tx("t1", 10)] }, { added: [tx("t2", 20)] }] });
    plaid.fail("/transactions/sync", { error_type: "TRANSACTIONS_ERROR", error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" });
    expect((await syncItem(env, itemId, { trigger: "cron" })).status).toBe("up_to_date");
    expect(await count("transactions")).toBe(2);
  });

  describe("pending → posted keeps my edits (§4)", () => {
    async function withEdits(pendingId: string) {
      const [pending] = await rows<{ id: string }>("SELECT id FROM transactions WHERE plaid_transaction_id = ?", pendingId);
      const id = pending!.id;
      const [other] = await rows<{ id: string }>("SELECT id FROM transactions WHERE plaid_transaction_id = 'other'");
      await env.DB.batch([
        env.DB.prepare("INSERT INTO transaction_overrides (transaction_id, category, note, updated_at) VALUES (?, 'FOOD', 'dinner with Sam', '2026-11-11')").bind(id),
        env.DB.prepare("INSERT INTO tags (id, name, created_at) VALUES ('tag1', 'Lisbon trip', '2026-11-11')"),
        env.DB.prepare("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, 'tag1')").bind(id),
        env.DB.prepare("INSERT INTO splits (id, transaction_id, amount_cents, category, position) VALUES ('sp1', ?, -500, 'FOOD', 0), ('sp2', ?, -500, 'FUN', 1)").bind(id, id),
        env.DB.prepare("INSERT INTO refund_links (id, refund_transaction_id, purchase_transaction_id, source, created_at) VALUES ('rl1', ?, ?, 'manual', '2026-11-11')").bind(other!.id, id),
      ]);
      return id;
    }

    it("reuses the pending row for the posted transaction (removal and addition in the same page)", async () => {
      const { itemId, fake } = await connected({ pages: [{ added: [tx("p1", 10, { pending: true }), tx("other", -10)] }] });
      await syncItem(env, itemId, { trigger: "cron" });
      const id = await withEdits("p1");

      fake.pages.push({ added: [tx("posted1", 10.5, { pending_transaction_id: "p1" })], removed: ["p1"] });
      await syncItem(env, itemId, { trigger: "webhook" });

      const all = await txRows();
      expect(all.map((r) => r.plaid_transaction_id).sort()).toEqual(["other", "posted1"]);
      const posted = all.find((r) => r.plaid_transaction_id === "posted1")!;
      expect(posted).toMatchObject({ id, pending: 0, removed: 0, amount_cents: -1050 });
      expect(await count("transaction_overrides", "transaction_id = ? AND note = 'dinner with Sam'", id)).toBe(1);
      expect(await count("transaction_tags", "transaction_id = ?", id)).toBe(1);
      expect(await count("splits", "transaction_id = ?", id)).toBe(2);
      expect(await count("refund_links", "purchase_transaction_id = ? AND needs_review = 0", id)).toBe(1);
    });

    it("also works when the removal arrives a sync before the posted version, clearing the review flags", async () => {
      const { itemId, fake } = await connected({ pages: [{ added: [tx("p1", 10, { pending: true }), tx("other", -10)] }] });
      await syncItem(env, itemId, { trigger: "cron" });
      const id = await withEdits("p1");

      fake.pages.push({ removed: ["p1"] });
      await syncItem(env, itemId, { trigger: "webhook" });
      expect(await count("transactions", "id = ? AND removed = 1", id)).toBe(1);
      expect(await count("refund_links", "needs_review = 1")).toBe(1);

      fake.pages.push({ added: [tx("posted1", 10, { pending_transaction_id: "p1" })] });
      await syncItem(env, itemId, { trigger: "webhook" });
      expect(await count("transactions", "id = ? AND removed = 0 AND plaid_transaction_id = 'posted1'", id)).toBe(1);
      expect(await count("refund_links", "needs_review = 1")).toBe(0);
      expect(await count("transaction_overrides", "transaction_id = ?", id)).toBe(1);
    });
  });

  it("marks removed transactions and flags what depends on them for review, deleting nothing", async () => {
    const { itemId, fake } = await connected({ pages: [{ added: [tx("out", 100), tx("in", -100, { account_id: "a-card" }), tx("plain", 5)] }] });
    await syncItem(env, itemId, { trigger: "cron" });
    const ids = Object.fromEntries((await txRows()).map((r) => [r.plaid_transaction_id, r.id]));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, source, created_at) VALUES ('tl1', ?, ?, 'auto', '2026-11-11')").bind(ids.out, ids.in),
      env.DB.prepare("INSERT INTO splits (id, transaction_id, amount_cents, position) VALUES ('sp1', ?, -10000, 0)").bind(ids.out),
    ]);

    fake.pages.push({ removed: ["out", "plain"] });
    const out = await syncItem(env, itemId, { trigger: "webhook" });
    expect(out).toMatchObject({ status: "up_to_date", removed: 2 });
    expect(await count("transactions")).toBe(3); // kept
    expect(await count("transactions", "removed = 1 AND removed_at IS NOT NULL")).toBe(2);
    expect(await count("transfer_links", "needs_review = 1")).toBe(1);
    expect(await count("splits")).toBe(1);

    const review = (await (await request("/sync/review")).json()) as { items: Array<{ id: string; splitCount: number; transferLinksToReview: number }> };
    expect(review.items).toHaveLength(1); // "plain" has nothing derived from it
    expect(review.items[0]).toMatchObject({ id: ids.out, splitCount: 1, transferLinksToReview: 1 });
  });

  it("refreshes balances and never overwrites my nickname, hidden flag or type fix", async () => {
    const { itemId, fake } = await connected({ pages: [{ added: [tx("t1", 1)] }] });
    await syncItem(env, itemId, { trigger: "cron" });
    await env.DB.prepare("UPDATE accounts SET nickname = 'Main', hidden = 1, kind_override = 'savings' WHERE plaid_account_id = 'a-checking'").run();
    fake.accounts[0]!.current = 2000;
    await syncItem(env, itemId, { trigger: "cron" });
    const [a] = await rows<Record<string, unknown>>("SELECT * FROM accounts WHERE plaid_account_id = 'a-checking'");
    expect(a).toMatchObject({ nickname: "Main", hidden: 1, kind_override: "savings", current_balance_cents: 200000 });
  });
});

describe("investments, liabilities and recurring (§4, §9, §17)", () => {
  it("syncs holdings, investment activity, credit statements and recurring streams when the item has those products", async () => {
    const { itemId } = await connected({
      products: ["transactions", "investments", "liabilities"],
      accounts: [...bankAccounts(), { account_id: "a-brokerage", name: "Brokerage", mask: "9999", type: "investment", subtype: "brokerage", current: 5000 }],
      pages: [{ added: [tx("sub1", 15.99, { account_id: "a-card" }), tx("sub2", 15.99, { account_id: "a-card" })] }],
      securities: [{ security_id: "sec-vti", name: "Vanguard Total", ticker_symbol: "VTI", type: "etf" }],
      holdings: [{ account_id: "a-brokerage", security_id: "sec-vti", quantity: 10.5, value: 2500.1 }],
      investmentTransactions: [
        { id: "it1", account_id: "a-brokerage", security_id: "sec-vti", date: "2026-11-01", amount: 1000, type: "buy", subtype: "buy", quantity: 4, name: "BUY VTI" },
        { id: "it2", account_id: "a-brokerage", security_id: null, date: "2026-11-02", amount: -12.5, type: "cash", subtype: "dividend", quantity: 0, name: "DIVIDEND" },
      ],
      credit: [{ account_id: "a-card", last_statement_balance: 410.25, next_payment_due_date: "2026-12-05", minimum_payment_amount: 35 }],
      streams: [{ stream_id: "st1", account_id: "a-card", description: "NETFLIX", direction: "outflow", amount: 15.99, transaction_ids: ["sub1", "sub2"] }],
    });
    for (let i = 0; i < 2; i++) expect((await syncItem(env, itemId, { trigger: "cron" })).status).toBe("up_to_date");

    expect(await rows("SELECT ticker_symbol FROM securities")).toEqual([{ ticker_symbol: "VTI" }]);
    expect(await rows("SELECT quantity, value_cents FROM holdings")).toEqual([{ quantity: 10.5, value_cents: 250010 }]);
    expect(await rows("SELECT plaid_investment_transaction_id AS id, amount_cents, subtype FROM investment_transactions ORDER BY id")).toEqual([
      { id: "it1", amount_cents: -100000, subtype: "buy" },
      { id: "it2", amount_cents: 1250, subtype: "dividend" },
    ]);
    expect(await rows("SELECT last_statement_balance_cents, next_payment_due_date, minimum_payment_cents FROM liabilities")).toEqual([
      { last_statement_balance_cents: 41025, next_payment_due_date: "2026-12-05", minimum_payment_cents: 3500 },
    ]);
    expect(await rows("SELECT description, average_amount_cents, frequency FROM recurring_items")).toEqual([{ description: "NETFLIX", average_amount_cents: -1599, frequency: "monthly" }]);
    expect(await count("recurring_item_transactions")).toBe(2);
    // Second sync: first investment window is the full history, later ones a trailing month.
    const [first, second] = plaid.callsTo("/investments/transactions/get");
    expect(String(first!.body.start_date) < String(second!.body.start_date)).toBe(true);
  });

  it("does not call Investments or Liabilities for a transactions-only item (calling would add the product)", async () => {
    const { itemId } = await connected({ pages: [] });
    await syncItem(env, itemId, { trigger: "cron" });
    expect(plaid.callsTo("/investments/holdings/get")).toHaveLength(0);
    expect(plaid.callsTo("/liabilities/get")).toHaveLength(0);
  });

  it("keeps my paying-account choice and recurring edits across syncs", async () => {
    const { itemId } = await connected({
      products: ["transactions", "liabilities"],
      credit: [{ account_id: "a-card", last_statement_balance: 100, next_payment_due_date: "2026-12-05", minimum_payment_amount: 25 }],
      streams: [{ stream_id: "st1", account_id: "a-card", description: "GYM", direction: "outflow", amount: 50, transaction_ids: [] }],
    });
    await syncItem(env, itemId, { trigger: "cron" });
    const [checking] = await rows<{ id: string }>("SELECT id FROM accounts WHERE plaid_account_id = 'a-checking'");
    const [rec] = await rows<{ id: string }>("SELECT id FROM recurring_items");
    await env.DB.batch([
      env.DB.prepare("UPDATE liabilities SET paying_account_id = ?").bind(checking!.id),
      env.DB.prepare("INSERT INTO recurring_overrides (recurring_item_id, name, removed, updated_at) VALUES (?, 'My gym', 0, '2026-11-11')").bind(rec!.id),
    ]);
    await syncItem(env, itemId, { trigger: "cron" });
    expect((await rows<{ paying_account_id: string }>("SELECT paying_account_id FROM liabilities"))[0]!.paying_account_id).toBe(checking!.id);
    expect(await rows("SELECT name FROM recurring_overrides")).toEqual([{ name: "My gym" }]);
    expect(await count("recurring_items")).toBe(1);
  });
});

describe("connection health (§4)", () => {
  it("records ITEM_LOGIN_REQUIRED from Plaid and shows it with a message and last-updated time", async () => {
    const { itemId, fake } = await connected({ institutionName: "Chase", pages: [{ added: [tx("t1", 1)] }], lastSuccessfulUpdate: "2026-11-17T08:00:00Z" });
    await syncItem(env, itemId, { trigger: "cron" });
    fake.error = "ITEM_LOGIN_REQUIRED";
    const out = await syncItem(env, itemId, { trigger: "cron" });
    expect(out).toMatchObject({ status: "error", errorCode: "ITEM_LOGIN_REQUIRED" });

    const health = (await (await request("/connections")).json()) as { items: Array<Record<string, unknown>> };
    expect(health.items[0]).toMatchObject({
      itemId,
      institutionName: "Chase",
      status: "login_required",
      errorCode: "ITEM_LOGIN_REQUIRED",
      needsReconnect: true,
      message: "Chase needs you to sign in again",
      lastUpdatedAt: "2026-11-17T08:00:00Z",
      lastUpdatedSource: "plaid",
      importStatus: "up_to_date",
      accountCount: 2,
    });
  });

  it("falls back to our own last sync time and warns before consent expires", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { itemId } = await connected({ consentExpiration: soon });
    await syncItem(env, itemId, { trigger: "cron" });
    const health = (await (await request("/connections")).json()) as { items: Array<Record<string, unknown>> };
    expect(health.items[0]).toMatchObject({ status: "pending_expiration", consentExpiresAt: soon, needsReconnect: true, lastUpdatedSource: "sync" });
    expect(health.items[0]!.lastUpdatedAt).toBeTruthy();
  });

  it("shows a bank as importing until Plaid's history download completes", async () => {
    await connected();
    const health = (await (await request("/connections")).json()) as { items: Array<Record<string, unknown>> };
    expect(health.items[0]).toMatchObject({ importStatus: "importing", lastUpdatedAt: null });
  });
});

describe("daily cron (§4, §5)", () => {
  it("syncs every bank, one failure doesn't stop the others, and saves today's snapshot per account", async () => {
    const good = await connected({ pages: [{ added: [tx("g1", 1)] }] });
    const bad = plaid.addItem({ accounts: bankAccounts("b"), error: "ITEM_LOGIN_REQUIRED" });
    const badId = await insertItem(bad);
    const later = plaid.addItem({ accounts: bankAccounts("c"), pages: [{ added: [{ transaction_id: "c1", account_id: "c-checking", amount: 2, date: "2026-11-10" }] }] });
    await insertItem(later);

    const { today, items, snapshots } = await runScheduled(env, Date.now());
    expect(items.map((i) => i.status).sort()).toEqual(["error", "up_to_date", "up_to_date"]);
    expect(await count("transactions")).toBe(2);
    expect((await rows<{ status: string }>("SELECT status FROM plaid_items WHERE id = ?", badId))[0]!.status).toBe("login_required");
    expect(snapshots.saved).toBe(4); // the broken bank never got accounts
    const snaps = await rows<{ date: string; balance_cents: number; source: string }>("SELECT date, balance_cents, source FROM balance_snapshots WHERE is_estimated = 0 ORDER BY balance_cents");
    expect(snaps.map((s) => s.balance_cents)).toEqual([-41025, -41025, 100050, 100050]);
    expect(new Set(snaps.map((s) => s.date))).toEqual(new Set([today]));
    expect(new Set(snaps.map((s) => s.source))).toEqual(new Set(["plaid"]));
    void good;

    // Running again the same day upserts (no duplicates).
    // (Estimated history rebuilt by afterDailySnapshots for the imported banks is separate.)
    const estimated = await count("balance_snapshots", "is_estimated = 1");
    await runScheduled(env, Date.now());
    expect(await count("balance_snapshots", "is_estimated = 0")).toBe(4);
    expect(await count("balance_snapshots", "is_estimated = 1")).toBe(estimated);
  });

  it("marks a balance that wasn't refreshed as carried forward, never fresh", async () => {
    const { itemId } = await connected();
    await syncItem(env, itemId, { trigger: "cron" });
    await env.DB.prepare("UPDATE accounts SET balance_updated_at = '2026-01-01T00:00:00.000Z' WHERE plaid_account_id = 'a-card'").run();
    await saveDailySnapshots(env, "2026-11-18");
    expect(await rows("SELECT source, is_carried_forward FROM balance_snapshots ORDER BY source")).toEqual([
      { source: "carried_forward", is_carried_forward: 1 },
      { source: "plaid", is_carried_forward: 0 },
    ]);
  });
});

describe("Refresh button (§4)", () => {
  it("asks Plaid to refresh each bank, fetches live balances, syncs, and reports per bank", async () => {
    const inv = await connected({ products: ["transactions", "investments"], pages: [{ added: [tx("t1", 1)] }] });
    const broken = plaid.addItem({ accounts: bankAccounts("z"), institutionName: "EverBank" });
    const brokenId = await insertItem(broken);
    plaid.fail("/transactions/refresh", { error_code: "ITEM_LOGIN_REQUIRED", times: 1 });

    const res = await request("/refresh", { method: "POST" });
    const { items } = (await res.json()) as { items: Array<Record<string, unknown>> };
    // Whichever bank hit the injected failure reports it; the other is up to date.
    expect(items.map((i) => String(i.status)).sort()).toEqual(["error", "up_to_date"]);
    const failed = items.find((i) => i.status === "error")!;
    expect(failed).toMatchObject({ errorCode: "ITEM_LOGIN_REQUIRED" });
    expect(String(failed.message)).toMatch(/sign in again/);
    expect(plaid.callsTo("/accounts/balance/get")).toHaveLength(1);
    void inv;
    void brokenId;
  });

  it("calls investments refresh only for items with Investments", async () => {
    await connected({ products: ["transactions", "investments"] });
    await connected();
    await request("/refresh", { method: "POST" });
    expect(plaid.callsTo("/transactions/refresh")).toHaveLength(2);
    expect(plaid.callsTo("/investments/refresh")).toHaveLength(1);
  });

  it("says when Refresh is next available if Plaid rate-limits it, and still syncs", async () => {
    const { itemId } = await connected({ pages: [{ added: [tx("t1", 1)] }] });
    plaid.fail("/transactions/refresh", { status: 429, error_type: "RATE_LIMIT_EXCEEDED", error_code: "TRANSACTIONS_LIMIT" });
    const first = (await (await request("/refresh", { method: "POST" })).json()) as { items: Array<Record<string, any>> };
    expect(first.items[0]).toMatchObject({ itemId, status: "rate_limited" });
    const until = Date.parse(first.items[0]!.refreshAvailableAt);
    expect(until).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(await count("transactions")).toBe(1);

    // Until then, Refresh does not call Plaid's refresh again.
    await request("/refresh", { method: "POST" });
    expect(plaid.callsTo("/transactions/refresh")).toHaveLength(1);
    const health = (await (await request("/connections")).json()) as { items: Array<Record<string, unknown>> };
    expect(health.items[0]!.refreshAvailableAt).toBe(first.items[0]!.refreshAvailableAt);
  });
});

describe("syncAllItems", () => {
  it("skips revoked items", async () => {
    const { itemId } = await connected();
    await env.DB.prepare("UPDATE plaid_items SET status = 'revoked' WHERE id = ?").bind(itemId).run();
    expect(await syncAllItems(env, "cron")).toEqual([]);
  });
});
