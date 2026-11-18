import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDeps } from "../../src/deps.ts";
import { decryptString } from "../../src/crypto/aes.ts";
import { ALLOWED_PRODUCTS } from "../../src/plaid/endpoints.ts";
import { addCredential, count, insertItem, request, rows } from "./helpers.ts";
import { FakePlaid, bankAccounts } from "./fake-plaid.ts";

let plaid: FakePlaid;
let restore: () => void;

beforeEach(async () => {
  await addCredential();
  plaid = new FakePlaid();
  restore = setDeps({ plaidFetch: plaid.fetch });
});
afterEach(() => restore());

const post = async (path: string, body: unknown = {}) => {
  const res = await request(path, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

async function startLink(): Promise<string> {
  const { status, body } = await post("/connections/link");
  expect(status).toBe(200);
  return body.sessionId as string;
}

/** The link token Plaid issued for our session (what the fake answers /link/token/get for). */
async function linkTokenOf(sessionId: string) {
  return (await rows<{ link_token: string }>("SELECT link_token FROM link_sessions WHERE id = ?", sessionId))[0]!.link_token;
}

const nothingSaved = async () => {
  expect(await count("plaid_items")).toBe(0);
  expect(await count("accounts")).toBe(0);
};

describe("Hosted Link sessions (§3)", () => {
  it("requests only read-only products, 24 months of history, and Hosted Link back to our redirect page", async () => {
    const { body } = await post("/connections/link");
    expect(body.hostedLinkUrl).toMatch(/^https:\/\/secure\.plaid\.com\/hl\//);
    expect(body.sessionId).toMatch(/^ls_[0-9a-f]{32}$/);
    const sent = plaid.callsTo("/link/token/create")[0]!.body;
    const requested = [...(sent.products as string[]), ...((sent.optional_products as string[]) ?? []), ...((sent.additional_consented_products as string[]) ?? []), ...((sent.required_if_supported_products as string[]) ?? [])];
    for (const p of requested) expect(ALLOWED_PRODUCTS).toContain(p);
    expect(requested).not.toEqual(expect.arrayContaining(["auth"]));
    expect(sent).not.toHaveProperty("auth");
    expect(sent).not.toHaveProperty("transfer");
    expect(sent).not.toHaveProperty("payment_initiation");
    expect(sent.products).toEqual(["transactions"]);
    expect(sent.transactions).toEqual({ days_requested: 730 });
    expect((sent.hosted_link as { completion_redirect_uri: string }).completion_redirect_uri).toBe(`http://localhost:8787/plaid/redirect?session=${body.sessionId}`);
    // Plaid cannot reach local wrangler dev, so no webhook is registered there.
    expect(sent).not.toHaveProperty("webhook");
  });

  it("registers the webhook when the Worker has a public https URL", async () => {
    const res = await request("/connections/link", { method: "POST", body: "{}", envOverrides: { PUBLIC_API_URL: "https://ft-api-dev.example.workers.dev" } });
    expect(res.status).toBe(200);
    expect(plaid.callsTo("/link/token/create")[0]!.body.webhook).toBe("https://ft-api-dev.example.workers.dev/plaid/webhook");
  });

  it("starts update mode for a reconnect with the item's token and no products", async () => {
    const fake = plaid.addItem({ accounts: bankAccounts() });
    const itemId = await insertItem(fake);
    const { status, body } = await post("/connections/link", { itemId });
    expect(status).toBe(200);
    expect(body.mode).toBe("update");
    const sent = plaid.callsTo("/link/token/create")[0]!.body;
    expect(sent.access_token).toBe(fake.accessToken);
    expect(sent).not.toHaveProperty("products");
    expect(sent).not.toHaveProperty("optional_products");
  });

  it("reports the Trial limit and refuses a new bank once 10 are connected", async () => {
    expect((await (await request("/connections/limit")).json()) as object).toEqual({ count: 0, limit: 10, remaining: 10, status: "ok" });
    for (let i = 0; i < 8; i++) await insertItem(plaid.addItem({ accounts: [] }));
    expect(((await (await request("/connections/limit")).json()) as { status: string }).status).toBe("close");
    for (let i = 0; i < 2; i++) await insertItem(plaid.addItem({ accounts: [] }));
    expect((await (await request("/connections/limit")).json()) as object).toEqual({ count: 10, limit: 10, remaining: 0, status: "reached" });
    const { status, body } = await post("/connections/link");
    expect(status).toBe(409);
    expect(body.error).toBe("TRIAL_LIMIT_REACHED");
    expect(plaid.callsTo("/link/token/create")).toHaveLength(0);
  });
});

describe("finalising a connection (§3)", () => {
  it("collects the result from Plaid, encrypts the token, saves trimmed accounts and starts the import", async () => {
    const fake = plaid.addItem({ accounts: bankAccounts(), institutionName: "First Platypus Bank", pages: [{ added: [{ transaction_id: "t1", account_id: "a-checking", amount: 5, date: "2026-11-10" }] }] });
    const sessionId = await startLink();

    // Before the user finishes, finalize reports pending.
    const early = await post("/connections/finalize", { sessionId });
    expect(early.status).toBe(202);
    expect(early.body.status).toBe("pending");

    plaid.linkTokens.set(await linkTokenOf(sessionId), [{ finished: true, publicToken: plaid.publicTokenFor(fake) }]);
    const { status, body } = await post("/connections/finalize", { sessionId });
    expect(status).toBe(200);
    expect(body.status).toBe("done");
    expect(body.institutionName).toBe("First Platypus Bank");
    expect(body.accounts.map((a: { name: string }) => a.name).sort()).toEqual(["Plaid Checking", "Plaid Credit Card"]);

    const [item] = await rows<{ access_token_enc: string; plaid_item_id: string }>("SELECT access_token_enc, plaid_item_id FROM plaid_items");
    expect(item!.access_token_enc).not.toContain("access-sandbox");
    expect(await decryptString(item!.access_token_enc, env.TOKEN_ENC_KEY)).toBe(fake.accessToken);
    // Debts are negative contributions; owner identity and official names never stored.
    const accts = await rows<Record<string, unknown>>("SELECT * FROM accounts ORDER BY name");
    expect(accts.map((a) => a.current_balance_cents)).toEqual([100050, -41025]);
    expect(JSON.stringify(accts)).not.toContain("Should Not Be Stored");
    expect(JSON.stringify(accts)).not.toContain("OFFICIAL");
    // The first import ran.
    expect(await count("transactions")).toBe(1);

    // Calling again (the app after the webhook already finished it) reports the same outcome.
    const again = await post("/connections/finalize", { sessionId });
    expect(again.body.status).toBe("done");
    expect(plaid.callsTo("/item/public_token/exchange")).toHaveLength(1);
  });

  it("cancelling in Link leaves nothing saved, and a new attempt works straight away", async () => {
    const sessionId = await startLink();
    plaid.linkTokens.set(await linkTokenOf(sessionId), [{ finished: true, exited: true, publicToken: null }]);
    const { body } = await post("/connections/finalize", { sessionId });
    expect(body).toMatchObject({ status: "cancelled", errorCode: "USER_EXIT" });
    await nothingSaved();
    expect(plaid.callsTo("/item/public_token/exchange")).toHaveLength(0);

    const fake = plaid.addItem({ accounts: bankAccounts() });
    const retry = await startLink();
    plaid.linkTokens.set(await linkTokenOf(retry), [{ finished: true, publicToken: plaid.publicTokenFor(fake) }]);
    expect((await post("/connections/finalize", { sessionId: retry })).body.status).toBe("done");
  });

  it("a Link error exit is reported with Plaid's code and saves nothing", async () => {
    const sessionId = await startLink();
    plaid.linkTokens.set(await linkTokenOf(sessionId), [{ finished: true, exitError: "INSTITUTION_DOWN" }]);
    expect((await post("/connections/finalize", { sessionId })).body).toMatchObject({ status: "cancelled", errorCode: "INSTITUTION_DOWN" });
    await nothingSaved();
  });

  for (const endpoint of ["/item/public_token/exchange", "/item/get", "/accounts/get"]) {
    it(`a failure partway (${endpoint}) leaves nothing half-saved`, async () => {
      const fake = plaid.addItem({ accounts: bankAccounts() });
      const sessionId = await startLink();
      plaid.linkTokens.set(await linkTokenOf(sessionId), [{ finished: true, publicToken: plaid.publicTokenFor(fake) }]);
      plaid.fail(endpoint, { status: 500, error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR" });
      const { body } = await post("/connections/finalize", { sessionId });
      expect(body).toMatchObject({ status: "failed", errorCode: "INTERNAL_SERVER_ERROR" });
      await nothingSaved();
      expect((await rows<{ pending_access_token_enc: string | null }>("SELECT pending_access_token_enc FROM link_sessions"))[0]!.pending_access_token_enc).toBeNull();
    });
  }

  it("warns about a bank that is already connected and never counts it twice", async () => {
    const first = plaid.addItem({ accounts: bankAccounts("x"), institutionId: "ins_same", institutionName: "Chase" });
    const s1 = await startLink();
    plaid.linkTokens.set(await linkTokenOf(s1), [{ finished: true, publicToken: plaid.publicTokenFor(first) }]);
    expect((await post("/connections/finalize", { sessionId: s1 })).body.status).toBe("done");

    // Same bank again (new Plaid item, same accounts).
    const second = plaid.addItem({ accounts: bankAccounts("y"), institutionId: "ins_same", institutionName: "Chase" });
    const s2 = await startLink();
    plaid.linkTokens.set(await linkTokenOf(s2), [{ finished: true, publicToken: plaid.publicTokenFor(second) }]);
    const dup = await post("/connections/finalize", { sessionId: s2 });
    expect(dup.body.status).toBe("duplicate");
    expect(dup.body.duplicates[0]).toMatchObject({ existingInstitutionName: "Chase", sameInstitution: true });
    expect(dup.body.duplicates[0].matchingAccounts).toHaveLength(2);
    expect(await count("plaid_items")).toBe(1); // held back until I choose
    expect(await count("accounts")).toBe(2);

    // Keep: saved, but the matching accounts are hidden, so nothing counts twice.
    const kept = await post("/connections/duplicate", { sessionId: s2, choice: "keep" });
    expect(kept.body.status).toBe("done");
    expect(await count("plaid_items")).toBe(2);
    expect(await count("accounts", "hidden = 0")).toBe(2);
    expect(await count("accounts", "hidden = 1")).toBe(2);
    expect((await rows<{ p: string | null }>("SELECT pending_access_token_enc AS p FROM link_sessions WHERE id = ?", s2))[0]!.p).toBeNull();
  });

  it("detects a duplicate by matching account mask and name at a different institution id, and can discard it", async () => {
    const first = plaid.addItem({ accounts: bankAccounts("x"), institutionId: "ins_a" });
    await post("/connections/link");
    const s1 = (await rows<{ id: string }>("SELECT id FROM link_sessions"))[0]!.id;
    plaid.linkTokens.set(await linkTokenOf(s1), [{ finished: true, publicToken: plaid.publicTokenFor(first) }]);
    await post("/connections/finalize", { sessionId: s1 });

    const second = plaid.addItem({ accounts: [bankAccounts("y")[0]!], institutionId: "ins_b" });
    const s2 = await startLink();
    plaid.linkTokens.set(await linkTokenOf(s2), [{ finished: true, publicToken: plaid.publicTokenFor(second) }]);
    const dup = await post("/connections/finalize", { sessionId: s2 });
    expect(dup.body.status).toBe("duplicate");
    expect(dup.body.duplicates[0]).toMatchObject({ sameInstitution: false });
    const discarded = await post("/connections/duplicate", { sessionId: s2, choice: "discard" });
    expect(discarded.body).toMatchObject({ status: "cancelled", errorCode: "DUPLICATE_DISCARDED" });
    expect(await count("plaid_items")).toBe(1);
    expect(await count("accounts")).toBe(2);
  });

  it("update mode marks the bank fixed and resyncs, with no new item", async () => {
    const fake = plaid.addItem({ accounts: bankAccounts() });
    const itemId = await insertItem(fake);
    await env.DB.prepare("UPDATE plaid_items SET status = 'login_required', error_code = 'ITEM_LOGIN_REQUIRED' WHERE id = ?").bind(itemId).run();
    const { body } = await post("/connections/link", { itemId });
    plaid.linkTokens.set(await linkTokenOf(body.sessionId), [{ finished: true }]);
    const fin = await post("/connections/finalize", { sessionId: body.sessionId });
    expect(fin.body.status).toBe("done");
    expect(await count("plaid_items")).toBe(1);
    expect((await rows<{ status: string }>("SELECT status FROM plaid_items"))[0]!.status).toBe("ok");
    expect(plaid.callsTo("/item/public_token/exchange")).toHaveLength(0);
    expect(plaid.callsTo("/transactions/sync").length).toBeGreaterThan(0);
  });
});

describe("dev-only Sandbox helpers", () => {
  it("connects a Sandbox bank through the same finalize code in dev", async () => {
    const fake = plaid.addItem({ accounts: bankAccounts() });
    // The fake answers /sandbox/public_token/create with a token for `fake`.
    (plaid as unknown as { handlers: Record<string, () => object> }).handlers["/sandbox/public_token/create"] = () => ({ public_token: plaid.publicTokenFor(fake) });
    const { status, body } = await post("/dev/sandbox/connect", {});
    expect(status).toBe(200);
    expect(body.result.status).toBe("done");
    expect(await count("accounts")).toBe(2);
  });

  it("does not exist in production, even with a valid credential", async () => {
    for (const path of ["/dev/sandbox/connect", "/dev/sandbox/fire-webhook", "/dev/sandbox/reset-login"]) {
      const res = await request(path, { method: "POST", body: "{}", envOverrides: { ENVIRONMENT: "production" } });
      expect(res.status, path).toBe(404);
    }
    expect(plaid.calls).toHaveLength(0);
  });
});

describe("Hosted Link redirect page (§3)", () => {
  it("hands off to financetracker:// with our session id and needs no credential", async () => {
    const id = "ls_0123456789abcdef0123456789abcdef";
    const res = await request(`/plaid/redirect?session=${id}`, { token: null });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain(`financetracker://plaid-complete?session=${id}`);
    expect(html).toContain("location.replace");
  });

  it("never echoes anything that is not one of our session ids", async () => {
    const res = await request(`/plaid/redirect?session=${encodeURIComponent('"><script>alert(1)</script>')}`, { token: null });
    const html = await res.text();
    expect(html).not.toContain("alert(1)");
    expect(html).toContain('"financetracker://plaid-complete"');
  });
});
