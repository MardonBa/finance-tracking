/**
 * Plaid Hosted Link Sandbox spike (docs/planning/plaid-hosted-link-spike.md).
 * Proves, headlessly and against Sandbox only, how far the Hosted Link flow
 * works without a browser. Prints findings, never tokens or secrets.
 *
 *   cd apps/api && set -a && source .dev.vars && set +a && \
 *     node --experimental-strip-types --no-warnings scripts/plaid-spike.ts
 */
import { PlaidApiError, createPlaidClient } from "../src/plaid/index.ts";

if ((process.env.PLAID_ENV ?? "sandbox") !== "sandbox") throw new Error("Sandbox only");
const plaid = createPlaidClient({ clientId: process.env.PLAID_CLIENT_ID!, secret: process.env.PLAID_SECRET!, env: "sandbox" });
const log = (...a: unknown[]) => console.log(...a);
const errText = (e: unknown) => (e instanceof PlaidApiError ? `${e.errorType}/${e.errorCode}: ${e.message}` : String(e));

const base = {
  client_name: "Finance Tracker",
  language: "en",
  country_codes: ["US"],
  user: { client_user_id: "owner" },
  products: ["transactions"],
  optional_products: ["investments", "liabilities"],
  transactions: { days_requested: 730 },
  webhook: "https://example.com/plaid/webhook",
} as const;

async function tryCreate(label: string, completion_redirect_uri: string | undefined, extra: Record<string, unknown> = {}) {
  try {
    const r = await plaid.call("/link/token/create", {
      ...base,
      hosted_link: completion_redirect_uri ? { completion_redirect_uri, url_lifetime_seconds: 1800 } : {},
      ...extra,
    } as never);
    log(`OK   ${label}: hosted_link_url=${r.hosted_link_url ? new URL(r.hosted_link_url).origin + "/…" : "none"} expires=${r.expiration}`);
    return r;
  } catch (e) {
    log(`FAIL ${label}: ${errText(e)}`);
    return null;
  }
}

log("== 1. /link/token/create with hosted_link");
const created = await tryCreate("https completion_redirect_uri", "https://ft-api-dev.example.workers.dev/plaid/redirect?session=s_test");
await tryCreate("http://localhost completion_redirect_uri", "http://localhost:8787/plaid/redirect?session=s_test");
await tryCreate("custom scheme completion_redirect_uri", "financetracker://plaid-complete?session=s_test");
await tryCreate("no completion_redirect_uri", undefined);
await tryCreate("OAuth institution preselected (ins_127287)", "https://ft-api-dev.example.workers.dev/plaid/redirect?session=s_test", {
  institution_id: "ins_127287",
});

if (created?.hosted_link_url) {
  log("\n== 2. Fetch the hosted link URL (no JS)");
  let url = created.hosted_link_url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, { redirect: "manual" });
    const shown = new URL(url).host + new URL(url).pathname.replace(/[A-Za-z0-9_-]{16,}/g, "<id>");
    log(`  GET ${shown} → ${res.status} ${res.headers.get("content-type") ?? ""}`);
    const loc = res.headers.get("location");
    if (!loc) {
      const body = await res.text();
      log(`  final page: ${body.length} bytes, <title>${/<title>([^<]*)/i.exec(body)?.[1] ?? "?"}</title>`);
      break;
    }
    url = new URL(loc, url).toString();
  }

  log("\n== 3. /link/token/get before the user does anything");
  const got = await plaid.call("/link/token/get", { link_token: created.link_token });
  log(`  link_sessions: ${JSON.stringify((got.link_sessions ?? []).map((s) => ({ finished: !!s.finished_at, results: !!s.results })))}`);
}

log("\n== 4. Sandbox OAuth bank (ins_127287 Platypus OAuth Bank) without Link");
for (const products of [["transactions"], ["transactions", "investments", "liabilities"]] as const) {
  try {
    const pt = await plaid.call("/sandbox/public_token/create", {
      institution_id: "ins_127287",
      initial_products: [...products],
      options: { transactions: { days_requested: 730 } },
    });
    const ex = await plaid.call("/item/public_token/exchange", { public_token: pt.public_token });
    const item = await plaid.call("/item/get", { access_token: ex.access_token });
    const accts = await plaid.call("/accounts/get", { access_token: ex.access_token });
    log(
      `OK   products=${products.join(",")}: institution=${item.item.institution_name} consent_expiration_time=${item.item.consent_expiration_time} ` +
        `products=${JSON.stringify((item.item as { products?: string[] }).products)} accounts=${accts.accounts.map((a) => `${a.type}/${a.subtype}`).join(",")}`,
    );
    // Update-mode token for the same item (reconnect).
    const upd = await plaid.call("/link/token/create", {
      client_name: base.client_name,
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: "owner" },
      access_token: ex.access_token,
      hosted_link: { completion_redirect_uri: "https://ft-api-dev.example.workers.dev/plaid/redirect?session=s_upd" },
    } as never);
    log(`OK   update-mode hosted link created: ${!!upd.hosted_link_url}`);
    // Simulate the bank asking for a re-login, then check item status.
    await plaid.call("/sandbox/item/reset_login", { access_token: ex.access_token });
    const after = await plaid.call("/item/get", { access_token: ex.access_token });
    log(`OK   after reset_login: item.error=${after.item.error?.error_code ?? "none"}`);
  } catch (e) {
    log(`FAIL products=${products.join(",")}: ${errText(e)}`);
  }
}

log("\n== 5. Non-OAuth bank with all three products");
try {
  const pt = await plaid.call("/sandbox/public_token/create", {
    institution_id: "ins_109508",
    initial_products: ["transactions"],
    options: { transactions: { days_requested: 730 } },
  });
  const ex = await plaid.call("/item/public_token/exchange", { public_token: pt.public_token });
  const item = await plaid.call("/item/get", { access_token: ex.access_token });
  log(`OK   ins_109508 products=${JSON.stringify((item.item as { products?: string[] }).products)} consent=${item.item.consent_expiration_time}`);
  for (const [ep, body] of [
    ["/investments/holdings/get", {}],
    ["/liabilities/get", {}],
  ] as const) {
    try {
      await plaid.call(ep, { access_token: ex.access_token, ...body });
      log(`OK   ${ep} on a transactions-only item`);
    } catch (e) {
      log(`INFO ${ep} on a transactions-only item → ${errText(e)}`);
    }
  }
  for (const ep of ["/transactions/refresh", "/investments/refresh"] as const) {
    try {
      await plaid.call(ep, { access_token: ex.access_token });
      log(`OK   ${ep}`);
    } catch (e) {
      log(`INFO ${ep} → ${errText(e)}`);
    }
  }
} catch (e) {
  log(`FAIL ${errText(e)}`);
}
