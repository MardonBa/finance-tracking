/**
 * The production-fixture anonymiser (§1): run over every saved Sandbox
 * response, its output still passes the same schemas (so an anonymised
 * production fixture still proves the format), no id, name or mask of the
 * input survives, and links between ids are kept.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READ_ONLY_ENDPOINTS, SANDBOX_ONLY_ENDPOINTS, type PlaidEndpoint } from "../../src/plaid/endpoints.ts";
import { RESPONSE_SCHEMAS } from "../../src/plaid/schemas.ts";
import { anonymise } from "../../scripts/anonymise-plaid.ts";

const ROOT = join(import.meta.dirname, "../fixtures/plaid/sandbox");
const endpointForFile = new Map<string, PlaidEndpoint>(
  [...READ_ONLY_ENDPOINTS, ...SANDBOX_ONLY_ENDPOINTS].map((e) => [`${e.slice(1).replaceAll("/", "_")}.json`, e]),
);
const files = readdirSync(ROOT)
  .filter((d) => statSync(join(ROOT, d)).isDirectory())
  .flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".json")).map((f) => ({ name: `${d}/${f}`, file: f, path: join(ROOT, d, f) })));

/** Every string value under a key matching `key`. */
function valuesOf(v: unknown, key: RegExp, out: string[] = [], k = ""): string[] {
  if (Array.isArray(v)) v.forEach((x) => valuesOf(x, key, out, k));
  else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) valuesOf(vv, key, out, kk);
  else if (typeof v === "string" && key.test(k)) out.push(v);
  return out;
}

describe("anonymising a Plaid response for a production fixture", () => {
  it("has Sandbox responses to try it on", () => expect(files.length).toBeGreaterThan(10));

  it.each(files)("$name still matches its schema, with no id, name or mask left", ({ file, path }) => {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const out = anonymise(raw);
    const endpoint = endpointForFile.get(file)!;
    expect(RESPONSE_SCHEMAS[endpoint].safeParse(out).error?.issues ?? []).toEqual([]);
    const text = JSON.stringify(out);
    const secrets = valuesOf(raw, /^(account_id|transaction_id|item_id|security_id|investment_transaction_id|request_id|mask|official_name|merchant_name|account_owner)$/).filter((s) => s.length >= 4);
    for (const s of secrets) expect(text, s).not.toContain(JSON.stringify(s));
  });

  it("keeps links between ids: the same id becomes the same placeholder everywhere", () => {
    const sync = {
      added: [
        { transaction_id: "tx_real_1", account_id: "acc_real", pending_transaction_id: null, merchant_name: "Corner Cafe", amount: 4.5 },
        { transaction_id: "tx_real_2", account_id: "acc_real", pending_transaction_id: "tx_real_1", merchant_name: "Corner Cafe", amount: 4.5 },
      ],
      accounts: [{ account_id: "acc_real", mask: "1234", name: "Jane's Checking", balances: { current: 10 } }],
    };
    const out = anonymise(sync) as typeof sync;
    expect(out.added[1]!.pending_transaction_id).toBe(out.added[0]!.transaction_id);
    expect(out.added[0]!.account_id).toBe(out.accounts[0]!.account_id);
    expect(out.added[0]!.merchant_name).toBe(out.added[1]!.merchant_name);
    expect(out.accounts[0]).toMatchObject({ mask: "0000", balances: { current: 10 } });
    expect(JSON.stringify(out)).not.toMatch(/real|Corner|Jane|1234/);
    expect(out.added[0]!.amount).toBe(4.5);
  });
});
