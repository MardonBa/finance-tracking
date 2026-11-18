/**
 * Anonymises a saved Plaid response before it goes into
 * test/fixtures/plaid/production/ (§1 "a few real production responses, with
 * identifying details removed"). Keeps the shape and every type the schemas
 * check, so the fixture still proves the format; replaces:
 *  - ids (account, transaction, item, security, …) with stable placeholders,
 *    the same placeholder everywhere an id repeats, so links survive;
 *  - names, descriptions, merchant names and masks with neutral text;
 *  - owners, addresses, locations, counterparties, URLs and logos with
 *    "REDACTED" (or 0 for coordinates).
 * Amounts, dates, categories and flags are kept.
 *
 *   node --experimental-strip-types scripts/anonymise-plaid.ts <in.json> <out.json>
 *
 * Read the output before committing it: anything this list misses stays.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ID_KEY = /(^|_)id$|_ids?$|^request_id$|^cursor$|^next_cursor$/;
const NAME_KEY = /^(name|official_name|merchant_name|original_description|description|institution_name|ticker_symbol|cusip|isin|sedol)$/;
const MASK_KEY = /^mask$/;
const REDACT_KEY = /owner|address|street|city|region|postal|country|store_number|counterpart|payer|payee|payment_meta|reference_number|ppd_id|by_order_of|website|logo_url|url$|email|phone|lat$|lon$/;
/** Ids we keep: Plaid's own fixed vocabularies, not identifiers of the user. */
const KEEP_ID_KEY = /^(category_id|personal_finance_category|iso_currency_code|unofficial_currency_code)$/;

export function anonymise(input: unknown): unknown {
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  const idFor = (key: string, v: string) => {
    if (!ids.has(v)) ids.set(v, `${key.replace(/_ids?$/, "").replace(/^id$/, "x")}_${ids.size + 1}`);
    return ids.get(v)!;
  };
  const nameFor = (v: string) => {
    if (!names.has(v)) names.set(v, `Name ${names.size + 1}`);
    return names.get(v)!;
  };
  const walk = (value: unknown, key: string): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    }
    if (value === null || value === undefined) return value;
    if (REDACT_KEY.test(key)) return typeof value === "number" ? 0 : typeof value === "string" ? "REDACTED" : value;
    if (typeof value !== "string") return value;
    if (KEEP_ID_KEY.test(key)) return value;
    if (ID_KEY.test(key)) return idFor(key, value);
    if (MASK_KEY.test(key)) return "0000";
    if (NAME_KEY.test(key)) return nameFor(value);
    return value;
  };
  return walk(input, "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error("Usage: node --experimental-strip-types scripts/anonymise-plaid.ts <in.json> <out.json>");
    process.exit(1);
  }
  writeFileSync(outPath, JSON.stringify(anonymise(JSON.parse(readFileSync(inPath, "utf8"))), null, 2) + "\n");
  console.log(`Wrote ${outPath}. Read it before committing.`);
}
