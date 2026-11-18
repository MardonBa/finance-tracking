/**
 * Creates Plaid SANDBOX items from the committed custom users
 * (seed/custom-users/*.json) plus Plaid's `user_transactions_dynamic` (whose
 * pending transactions post over time: the pending → posted case), without
 * Link, via the Sandbox-only /sandbox/public_token/create.
 *
 *   node --experimental-strip-types seed/sandbox.ts --sql <out.sql>
 *       write plaid_items rows (tokens encrypted with TOKEN_ENC_KEY) for reset:dev
 *   node --experimental-strip-types seed/sandbox.ts --capture <dir>
 *       also save raw responses as test fixtures (Sandbox data is fake)
 *
 * Needs PLAID_CLIENT_ID, PLAID_SECRET (the Sandbox secret) and TOKEN_ENC_KEY
 * in the environment. Refuses to run unless PLAID_ENV is "sandbox".
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createPlaidClient, type PlaidEndpoint } from "../src/plaid/index.ts";
import { encryptString } from "../src/crypto/aes.ts";
import { plaidItems } from "../src/db/schema.ts";
import { insertSql } from "./sql.ts";

const SANDBOX_INSTITUTION = "ins_109508"; // First Platypus Bank (non-OAuth, honours custom users)
const arg = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const sqlOut = arg("--sql");
const captureDir = arg("--capture");

if ((process.env.PLAID_ENV ?? "sandbox") !== "sandbox") throw new Error("seed/sandbox.ts only runs against Plaid Sandbox");
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (run npm run sync:dev-vars)`);
  return v;
};

let captured: Record<string, unknown> = {};
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const body = await res.clone().json().catch(() => null);
  const endpoint = new URL(String(input)).pathname;
  if (!endpoint.includes("token")) captured[endpoint] = body; // never save responses that carry tokens
  return res;
};

const plaid = createPlaidClient({ clientId: need("PLAID_CLIENT_ID"), secret: need("PLAID_SECRET"), env: "sandbox", fetch: recordingFetch });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SandboxUser {
  name: string;
  products: Array<"transactions" | "investments" | "liabilities">;
  username: string;
  password: string;
}

const customDir = join(import.meta.dirname, "custom-users");
const users: SandboxUser[] = readdirSync(customDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const config = JSON.parse(readFileSync(join(customDir, f), "utf8")) as { override_accounts: Array<{ type: string }> };
    const types = new Set(config.override_accounts.map((a) => a.type));
    const products: SandboxUser["products"] = ["transactions"];
    if (types.has("investment")) products.push("investments");
    if (types.has("credit")) products.push("liabilities");
    return { name: basename(f, ".json"), products, username: "user_custom", password: JSON.stringify(config) };
  });
users.push({ name: "transactions-dynamic", products: ["transactions"], username: "user_transactions_dynamic", password: "any" });

async function syncAll(accessToken: string) {
  let cursor: string | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const page = await plaid.call("/transactions/sync", { access_token: accessToken, cursor, count: 500, options: { include_original_description: true } });
    cursor = page.next_cursor;
    if (!page.has_more && page.transactions_update_status === "HISTORICAL_UPDATE_COMPLETE") return page;
    if (!page.has_more) await sleep(2000);
  }
  throw new Error("Sandbox transactions never finished their historical update");
}

const rows: object[] = [];
for (const user of users) {
  captured = {};
  const created = await plaid.call("/sandbox/public_token/create", {
    institution_id: SANDBOX_INSTITUTION,
    initial_products: user.products,
    options: { override_username: user.username, override_password: user.password, transactions: { days_requested: 730 } },
  });
  const exchanged = await plaid.call("/item/public_token/exchange", { public_token: created.public_token });
  const item = await plaid.call("/item/get", { access_token: exchanged.access_token });
  console.log(`Created Sandbox item for ${user.name} (${user.products.join(", ")})`);

  if (captureDir) {
    await plaid.call("/accounts/get", { access_token: exchanged.access_token });
    await syncAll(exchanged.access_token);
    await plaid.call("/institutions/get_by_id", { institution_id: SANDBOX_INSTITUTION, country_codes: ["US"] });
    if (user.products.includes("transactions")) {
      try {
        await plaid.call("/transactions/recurring/get", { access_token: exchanged.access_token });
      } catch (e) {
        console.warn(`  recurring not ready for ${user.name}: ${(e as Error).message}`);
      }
    }
    if (user.products.includes("investments")) {
      await plaid.call("/investments/holdings/get", { access_token: exchanged.access_token });
      await plaid.call("/investments/transactions/get", { access_token: exchanged.access_token, start_date: "2024-01-01", end_date: "2030-01-01" });
    }
    if (user.products.includes("liabilities")) await plaid.call("/liabilities/get", { access_token: exchanged.access_token });
    const dir = join(captureDir, user.name);
    mkdirSync(dir, { recursive: true });
    for (const [endpoint, body] of Object.entries(captured)) {
      const file = endpoint.replace(/^\//, "").replaceAll("/", "_") + ".json";
      writeFileSync(join(dir, file), `${JSON.stringify(body, null, 2)}\n`);
    }
    console.log(`  captured ${Object.keys(captured).length} responses → ${dir}`);
  }

  rows.push({
    id: `item_sandbox_${user.name}`,
    plaidItemId: item.item.item_id,
    institutionId: item.item.institution_id ?? null,
    institutionName: item.item.institution_name ?? "First Platypus Bank",
    accessTokenEnc: await encryptString(exchanged.access_token, need("TOKEN_ENC_KEY")),
    transactionsCursor: null,
    status: "ok",
    errorCode: null,
    consentExpiresAt: null,
    lastSuccessfulUpdateAt: null,
    lastSyncedAt: null,
    createdAt: new Date().toISOString(),
  });
}

if (sqlOut) {
  writeFileSync(sqlOut, `${insertSql(plaidItems, rows).join("\n")}\n`);
  console.log(`Wrote ${rows.length} Sandbox items → ${sqlOut}`);
}

// Keep the endpoint type referenced so the capture keys stay meaningful.
export type CapturedEndpoint = PlaidEndpoint;
