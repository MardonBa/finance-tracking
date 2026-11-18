import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDeps } from "../../src/deps.ts";
import { clearWebhookKeyCache } from "../../src/plaid/webhook-verify.ts";
import { count, insertItem, request, rows } from "./helpers.ts";
import { FakePlaid, bankAccounts } from "./fake-plaid.ts";
import { webhookSigner } from "./signers.ts";

let plaid: FakePlaid;
let signer: Awaited<ReturnType<typeof webhookSigner>>;
let restore: () => void;

beforeEach(async () => {
  clearWebhookKeyCache();
  plaid = new FakePlaid();
  signer = await webhookSigner();
  restore = setDeps({ plaidFetch: plaid.fetch, plaidWebhookKey: signer.fetchKey });
});
afterEach(() => restore());

async function send(payload: unknown, header?: string | null, rawOverride?: string) {
  const body = rawOverride ?? JSON.stringify(payload);
  const verification = header === undefined ? await signer.sign(body) : header;
  return request("/plaid/webhook", { method: "POST", token: null, body, headers: verification ? { "plaid-verification": verification } : {} });
}

async function connectedItem() {
  const fake = plaid.addItem({ accounts: bankAccounts(), pages: [{ added: [{ transaction_id: "t1", account_id: "a-checking", amount: 3, date: "2026-11-10" }] }] });
  const itemId = await insertItem(fake);
  return { fake, itemId };
}

const syncUpdates = (itemId: string) => ({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: itemId, environment: "sandbox" });

describe("Plaid webhook verification (§2)", () => {
  it("acts on a correctly signed webhook (SYNC_UPDATES_AVAILABLE syncs the item)", async () => {
    const { fake } = await connectedItem();
    const res = await send(syncUpdates(fake.itemId));
    expect(res.status).toBe(200);
    expect(await count("transactions")).toBe(1);
    expect(await rows("SELECT \"trigger\" AS t FROM sync_runs")).toEqual([{ t: "webhook" }]);
  });

  it("caches the verification key between webhooks", async () => {
    const { fake } = await connectedItem();
    await send(syncUpdates(fake.itemId));
    await send(syncUpdates(fake.itemId));
    expect(signer.keyFetches).toBe(1);
  });

  it("rejects unverified webhooks with an empty 401 and does nothing", async () => {
    const { fake } = await connectedItem();
    const body = JSON.stringify(syncUpdates(fake.itemId));
    const other = await webhookSigner("plaid-test-key"); // same kid, different private key
    const nowS = Math.floor(Date.now() / 1000);
    const bad: Array<[string, string | null, string?]> = [
      ["no header", null],
      ["garbage header", "not.a.jwt"],
      ["signed by another key", await other.sign(body)],
      ["stale (6 minutes old)", await signer.sign(body, { iatS: nowS - 6 * 60 })],
      ["body hash mismatch", await signer.sign(body, { bodyHash: "0".repeat(64) })],
      ["wrong algorithm", await signer.sign(body, { alg: "HS256" })],
      ["body tampered after signing", await signer.sign(body), body.replace("SYNC_UPDATES_AVAILABLE", "SYNC_UPDATES_AVAILABLE ")],
    ];
    for (const [label, header, raw] of bad) {
      const res = await send(null, header, raw ?? body);
      expect(res.status, label).toBe(401);
      expect(await res.text(), label).toBe("");
    }
    expect(plaid.calls).toHaveLength(0);
    expect(await count("sync_runs")).toBe(0);
    expect(await count("transactions")).toBe(0);
  });

  it("refuses a key Plaid has marked expired", async () => {
    const { fake } = await connectedItem();
    signer.jwk.expired_at = Math.floor(Date.now() / 1000) - 60;
    const res = await send(syncUpdates(fake.itemId));
    expect(res.status).toBe(401);
    expect(plaid.calls).toHaveLength(0);
  });
});

describe("webhook handling (§3, §4)", () => {
  it("ITEM: ERROR records the error so the app prompts to reconnect", async () => {
    const { fake, itemId } = await connectedItem();
    await send({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: fake.itemId, error: { error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR" } });
    expect(await rows("SELECT status, error_code FROM plaid_items WHERE id = ?", itemId)).toEqual([{ status: "login_required", error_code: "ITEM_LOGIN_REQUIRED" }]);
    await send({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: fake.itemId });
    expect(await rows("SELECT status, error_code FROM plaid_items WHERE id = ?", itemId)).toEqual([{ status: "ok", error_code: null }]);
  });

  it("PENDING_EXPIRATION and PENDING_DISCONNECT warn before access ends", async () => {
    const { fake, itemId } = await connectedItem();
    await send({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", item_id: fake.itemId, consent_expiration_time: "2026-12-01T00:00:00Z" });
    expect(await rows("SELECT status, error_code, consent_expires_at FROM plaid_items WHERE id = ?", itemId)).toEqual([
      { status: "pending_expiration", error_code: "PENDING_EXPIRATION", consent_expires_at: "2026-12-01T00:00:00Z" },
    ]);
    await send({ webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT", item_id: fake.itemId, reason: "INSTITUTION_MIGRATION" });
    expect(await rows("SELECT status, error_code FROM plaid_items WHERE id = ?", itemId)).toEqual([{ status: "pending_expiration", error_code: "PENDING_DISCONNECT" }]);
  });

  it("USER_PERMISSION_REVOKED marks the bank revoked", async () => {
    const { fake, itemId } = await connectedItem();
    await send({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: fake.itemId });
    expect(await rows("SELECT status FROM plaid_items WHERE id = ?", itemId)).toEqual([{ status: "revoked" }]);
  });

  it("HOLDINGS and INVESTMENTS_TRANSACTIONS updates sync investments only", async () => {
    const fake = plaid.addItem({
      products: ["transactions", "investments"],
      accounts: [{ account_id: "inv", name: "Brokerage", mask: "1", type: "investment", subtype: "brokerage", current: 10 }],
      securities: [{ security_id: "s", name: "S", ticker_symbol: "S", type: "equity" }],
      holdings: [{ account_id: "inv", security_id: "s", quantity: 1, value: 10 }],
    });
    await insertItem(fake);
    await send({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE", item_id: fake.itemId });
    await send({ webhook_type: "INVESTMENTS_TRANSACTIONS", webhook_code: "DEFAULT_UPDATE", item_id: fake.itemId });
    expect(await count("holdings")).toBe(1);
    expect(plaid.callsTo("/investments/holdings/get")).toHaveLength(2);
    expect(plaid.callsTo("/transactions/sync")).toHaveLength(0);
  });

  it("SESSION_FINISHED collects the Link result and saves the bank (no app needed)", async () => {
    const { addCredential } = await import("./helpers.ts");
    await addCredential();
    const fake = plaid.addItem({ accounts: bankAccounts() });
    const res = await request("/connections/link", { method: "POST", body: "{}" });
    const { sessionId } = (await res.json()) as { sessionId: string };
    const [{ link_token }] = (await rows<{ link_token: string }>("SELECT link_token FROM link_sessions")) as [{ link_token: string }];
    plaid.linkTokens.set(link_token, [{ finished: true, publicToken: plaid.publicTokenFor(fake) }]);

    await send({ webhook_type: "LINK", webhook_code: "SESSION_FINISHED", status: "SUCCESS", link_session_id: "x", link_token, public_tokens: ["redacted"], environment: "sandbox" });
    expect(await count("plaid_items")).toBe(1);
    expect(await count("accounts")).toBe(2);
    expect(await rows("SELECT status FROM link_sessions WHERE id = ?", sessionId)).toEqual([{ status: "done" }]);
    // The app's own finalize call afterwards just reads the outcome.
    const fin = (await (await request("/connections/finalize", { method: "POST", body: JSON.stringify({ sessionId }) })).json()) as { status: string };
    expect(fin.status).toBe("done");
    expect(plaid.callsTo("/item/public_token/exchange")).toHaveLength(1);
  });

  it("ignores webhooks for unknown items and unknown codes", async () => {
    expect((await send({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "nope" })).status).toBe(200);
    expect((await send({ webhook_type: "WHATEVER", webhook_code: "NEW" })).status).toBe(200);
    expect(plaid.calls).toHaveLength(0);
  });
});
