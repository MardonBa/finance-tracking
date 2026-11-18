import { describe, expect, it, vi } from "vitest";
import { ALLOWED_PRODUCTS, READ_ONLY_ENDPOINTS, SANDBOX_ONLY_ENDPOINTS } from "../../src/plaid/endpoints.ts";
import { RESPONSE_SCHEMAS } from "../../src/plaid/schemas.ts";
import { PlaidApiError, PlaidSchemaError, createPlaidClient } from "../../src/plaid/client.ts";

// Changing the allowlist must be a deliberate, reviewed edit of this snapshot (§2).
const READ_ONLY_SNAPSHOT = [
  "/link/token/create",
  "/link/token/get",
  "/item/public_token/exchange",
  "/item/get",
  "/accounts/get",
  "/accounts/balance/get",
  "/transactions/sync",
  "/transactions/refresh",
  "/transactions/recurring/get",
  "/investments/holdings/get",
  "/investments/transactions/get",
  "/investments/refresh",
  "/liabilities/get",
  "/institutions/get_by_id",
  "/webhook_verification_key/get",
];
const SANDBOX_SNAPSHOT = ["/sandbox/public_token/create", "/sandbox/item/fire_webhook", "/sandbox/item/reset_login", "/sandbox/transactions/create"];

const FORBIDDEN =
  /\/(auth|identity|transfer|bank_transfer|payment_initiation|processor|signal|deposit_switch|income|employment|asset_report|credit|cra|wallet|payment_profile|beacon|statements)(\/|$)|\/item\/remove|\/item\/access_token\/invalidate|\/numbers/;

describe("Plaid endpoint allowlist (§2 no money can move)", () => {
  it("matches its snapshot exactly", () => {
    expect([...READ_ONLY_ENDPOINTS]).toEqual(READ_ONLY_SNAPSHOT);
    expect([...SANDBOX_ONLY_ENDPOINTS]).toEqual(SANDBOX_SNAPSHOT);
  });

  it("contains no Auth, Identity, Transfer, Payment Initiation, processor or other money-moving endpoints", () => {
    for (const e of [...READ_ONLY_ENDPOINTS, ...SANDBOX_ONLY_ENDPOINTS]) expect(e, e).not.toMatch(FORBIDDEN);
    expect(FORBIDDEN.test("/auth/get")).toBe(true);
    expect(FORBIDDEN.test("/transfer/create")).toBe(true);
    expect(FORBIDDEN.test("/processor/token/create")).toBe(true);
    expect(FORBIDDEN.test("/identity/get")).toBe(true);
    expect(FORBIDDEN.test("/payment_initiation/payment/create")).toBe(true);
  });

  it("only allows read-only Link products", () => {
    expect([...ALLOWED_PRODUCTS]).toEqual(["transactions", "investments", "liabilities"]);
  });

  it("has a response schema for every allowed endpoint and nothing else", () => {
    expect(Object.keys(RESPONSE_SCHEMAS).sort()).toEqual([...READ_ONLY_SNAPSHOT, ...SANDBOX_SNAPSHOT].sort());
  });
});

describe("Plaid client", () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it("refuses Sandbox-only endpoints in production", async () => {
    const fetch = ok({});
    const client = createPlaidClient({ clientId: "c", secret: "s", env: "production", fetch });
    await expect(client.call("/sandbox/public_token/create", { institution_id: "x", initial_products: ["transactions"] })).rejects.toThrow(
      /Refusing Sandbox-only endpoint/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses any endpoint outside the allowlist, even when forced past the types", async () => {
    const fetch = ok({});
    const client = createPlaidClient({ clientId: "c", secret: "s", env: "sandbox", fetch });
    await expect(client.call("/transfer/create" as never, {} as never)).rejects.toThrow(/not on the read-only allowlist/);
    await expect(client.call("/auth/get" as never, {} as never)).rejects.toThrow(/not on the read-only allowlist/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends credentials in the body to the right host and validates the response", async () => {
    const fetch = ok({ request_id: "r1" });
    const client = createPlaidClient({ clientId: "cid", secret: "sec", env: "sandbox", fetch });
    await expect(client.call("/transactions/refresh", { access_token: "a" })).resolves.toEqual({ request_id: "r1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox.plaid.com/transactions/refresh");
    expect(JSON.parse(String(init.body))).toEqual({ access_token: "a", client_id: "cid", secret: "sec" });
  });

  it("fails loudly when a response does not match its schema", async () => {
    const client = createPlaidClient({ clientId: "c", secret: "s", env: "production", fetch: ok({ request_id: "r", item: { item_id: 5 } }) });
    await expect(client.call("/item/get", { access_token: "a" })).rejects.toBeInstanceOf(PlaidSchemaError);
  });

  it("turns Plaid errors into PlaidApiError with the code, never the request", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "login", request_id: "r" }), {
          status: 400,
        }),
    );
    const client = createPlaidClient({ clientId: "c", secret: "super-secret", env: "sandbox", fetch });
    const err = (await client.call("/item/get", { access_token: "access-sandbox-xyz" }).catch((e: unknown) => e)) as PlaidApiError;
    expect(err).toBeInstanceOf(PlaidApiError);
    expect(err.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(err.message).not.toContain("super-secret");
    expect(err.message).not.toContain("access-sandbox-xyz");
  });

  it("rejects an unknown PLAID_ENV", () => {
    expect(() => createPlaidClient({ clientId: "c", secret: "s", env: "development" as never })).toThrow(/PLAID_ENV/);
  });
});
