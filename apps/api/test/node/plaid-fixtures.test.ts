/**
 * Saved Plaid responses (real Sandbox captures from `seed/sandbox.ts
 * --capture`, plus anonymised production ones added in Phase 4) must pass the
 * same schemas, and trimming must keep only the stored fields (§1, §2).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READ_ONLY_ENDPOINTS, SANDBOX_ONLY_ENDPOINTS, type PlaidEndpoint } from "../../src/plaid/endpoints.ts";
import { RESPONSE_SCHEMAS, transactionsSyncSchema } from "../../src/plaid/schemas.ts";
import {
  trimAccount,
  trimCreditLiability,
  trimHolding,
  trimInvestmentTransaction,
  trimItem,
  trimSecurity,
  trimStream,
  trimTransaction,
} from "../../src/plaid/trim.ts";
import { isCents } from "@ft/core";

const FIXTURES = join(import.meta.dirname, "../fixtures/plaid");
const endpointForFile = new Map<string, PlaidEndpoint>(
  [...READ_ONLY_ENDPOINTS, ...SANDBOX_ONLY_ENDPOINTS].map((e) => [`${e.slice(1).replaceAll("/", "_")}.json`, e]),
);

function fixtureFiles(env: "sandbox" | "production") {
  const root = join(FIXTURES, env);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => statSync(join(root, d)).isDirectory())
    .flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith(".json")).map((f) => ({ item: d, file: f, path: join(root, d, f) })));
}

const load = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

describe.each(["sandbox", "production"] as const)("%s fixtures", (env) => {
  const files = fixtureFiles(env);
  it(env === "sandbox" ? "exist" : "are optional until Phase 4", () => {
    if (env === "sandbox") expect(files.length).toBeGreaterThan(10);
    else expect(files.length).toBeGreaterThanOrEqual(0);
  });

  for (const f of files) {
    it(`${f.item}/${f.file} matches its schema`, () => {
      const endpoint = endpointForFile.get(f.file);
      expect(endpoint, `no endpoint for ${f.file}`).toBeDefined();
      const result = RESPONSE_SCHEMAS[endpoint!].safeParse(load(f.path));
      expect(result.error?.issues ?? []).toEqual([]);
    });
  }
});

/** Field names and values that must never survive trimming. */
const FORBIDDEN_KEYS = /owner|address|location|lat|lon|city|region|postal|country|store_number|payment_meta|payer|payee|counterpart|logo|website|account_number|routing|wire|iban|official_name|check_number|unofficial/i;

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** A Sandbox-shaped transaction with every sensitive field Plaid can send filled in. */
const fullTransaction = {
  account_id: "acc1",
  account_owner: "Alberta Bobbeth Charleson",
  amount: 12.34,
  authorized_date: "2026-11-01",
  authorized_datetime: "2026-11-01T10:00:00Z",
  category: ["Food and Drink", "Restaurants"],
  category_id: "13005000",
  check_number: "1234",
  counterparties: [{ name: "Secret Cafe", type: "merchant", logo_url: "https://x/logo.png", website: "secret.example", entity_id: "e1", confidence_level: "HIGH" }],
  date: "2026-11-02",
  datetime: null,
  iso_currency_code: "USD",
  location: { address: "1 Private Lane", city: "Hometown", region: "CA", postal_code: "94000", country: "US", lat: 37.1, lon: -122.1, store_number: "42" },
  logo_url: "https://x/logo.png",
  merchant_entity_id: "ent_cafe",
  merchant_name: "Secret Cafe",
  name: "SECRET CAFE 42",
  original_description: "SECRET CAFE #42 HOMETOWN CA",
  payment_channel: "in store",
  payment_meta: { by_order_of: "Jane Doe", payee: "Secret Cafe", payer: "Alberta Charleson", payment_method: "card", payment_processor: null, ppd_id: null, reason: null, reference_number: "ref-999" },
  pending: false,
  pending_transaction_id: null,
  personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT", confidence_level: "VERY_HIGH" },
  personal_finance_category_icon_url: "https://x/icon.png",
  transaction_code: null,
  transaction_id: "tx1",
  transaction_type: "place",
  unofficial_currency_code: null,
  website: "secret.example",
};
const fullAccount = {
  account_id: "acc1",
  balances: { available: 100, current: 110.5, iso_currency_code: "USD", limit: null, unofficial_currency_code: null, last_updated_datetime: null },
  mask: "0000",
  name: "Plaid Checking",
  official_name: "Plaid Gold Standard 0% Interest Checking",
  subtype: "checking",
  type: "depository",
  owners: [{ names: ["Alberta Bobbeth Charleson"], addresses: [{ data: { street: "2992 Cameron Road", city: "Malakoff" } }], emails: [{ data: "a@example.com" }], phone_numbers: [{ data: "1112223333" }] }],
  verification_status: null,
  holder_category: "personal",
};

describe("trimming (§2 store only what is needed)", () => {
  it("a full Sandbox-shaped sync response keeps only the stored transaction fields", () => {
    const parsed = transactionsSyncSchema.parse({
      accounts: [fullAccount],
      added: [fullTransaction],
      modified: [],
      removed: [],
      next_cursor: "c",
      has_more: false,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      request_id: "r",
    });
    const trimmed = trimTransaction(parsed.added[0]!);
    expect(Object.keys(trimmed).sort()).toEqual(
      [
        "amountCents",
        "authorizedDate",
        "date",
        "isoCurrencyCode",
        "merchantEntityId",
        "merchantName",
        "pending",
        "pendingTransactionId",
        "plaidAccountId",
        "plaidCategoryConfidence",
        "plaidCategoryDetailed",
        "plaidCategoryPrimary",
        "plaidTransactionId",
        "rawDescription",
      ].sort(),
    );
    const text = JSON.stringify(trimmed);
    for (const secret of ["Alberta", "Private Lane", "Hometown", "94000", "37.1", "Jane Doe", "ref-999", "logo", "secret.example"]) {
      expect(text).not.toContain(secret);
    }
    expect(trimmed.amountCents).toBe(-1234); // money out is negative in our convention
    expect(trimmed.rawDescription).toBe("SECRET CAFE #42 HOMETOWN CA");

    const account = trimAccount(parsed.accounts[0]!, "2026-11-18T00:00:00.000Z");
    expect(Object.keys(account).sort()).toEqual(
      ["balanceUpdatedAt", "currentBalanceCents", "isoCurrencyCode", "mask", "name", "plaidAccountId", "subtype", "type"].sort(),
    );
    expect(JSON.stringify(account)).not.toMatch(/Alberta|Cameron|Malakoff|example\.com|1112223333|Gold Standard/);
    expect(account.currentBalanceCents).toBe(11050);
  });

  it("debts are stored as negative net-worth contributions", () => {
    const card = trimAccount({ ...fullAccount, type: "credit", subtype: "credit card", balances: { ...fullAccount.balances, current: 431.1 } }, "t");
    expect(card.currentBalanceCents).toBe(-43110);
  });

  describe.each(["sandbox", "production"] as const)("every saved %s response trims to allowed fields only", (env) => {
    const files = fixtureFiles(env);
    it("covers every saved file", () => expect(files.length).toBeGreaterThanOrEqual(env === "sandbox" ? 10 : 0));
    for (const f of files) {
      const endpoint = endpointForFile.get(f.file);
      it(`${f.item}/${f.file}`, () => {
        const body = RESPONSE_SCHEMAS[endpoint!].parse(load(f.path)) as Record<string, unknown>;
        const trimmed: unknown[] = [];
        const b = body as unknown as Record<string, never[]>;
        if ("accounts" in body) trimmed.push(...(b.accounts as never[]).map((a) => trimAccount(a, "t")));
        if (endpoint === "/transactions/sync") trimmed.push(...[...(b.added as never[]), ...(b.modified as never[])].map(trimTransaction));
        if (endpoint === "/item/get") trimmed.push(trimItem(body as never));
        if (endpoint === "/transactions/recurring/get") {
          trimmed.push(...(b.inflow_streams as never[]).map((s) => trimStream(s, "inflow")), ...(b.outflow_streams as never[]).map((s) => trimStream(s, "outflow")));
        }
        if ("securities" in body) trimmed.push(...(b.securities as never[]).map(trimSecurity));
        if (endpoint === "/investments/holdings/get") trimmed.push(...(b.holdings as never[]).map(trimHolding));
        if (endpoint === "/investments/transactions/get") trimmed.push(...(b.investment_transactions as never[]).map(trimInvestmentTransaction));
        if (endpoint === "/liabilities/get") trimmed.push(...((b.liabilities as unknown as { credit: never[] | null }).credit ?? []).map(trimCreditLiability));

        const keys = [...allKeys(trimmed)];
        expect(keys.filter((k) => FORBIDDEN_KEYS.test(k))).toEqual([]);
        for (const t of trimmed) {
          for (const [k, v] of Object.entries(t as object)) if (/Cents$/.test(k) && v !== null) expect(isCents(v), k).toBe(true);
        }
      });
    }
  });
});
