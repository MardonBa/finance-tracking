/**
 * End-to-end run against Plaid SANDBOX through a local `wrangler dev --env dev`
 * (docs/planning/plaid-hosted-link-spike.md "End-to-end run"). Prints status
 * lines and counts only, never tokens or secrets.
 *
 *   npm run reset:dev
 *   cd apps/api && npx wrangler dev --env dev --port 8787 --test-scheduled     (separate terminal)
 *   cd apps/api && node --env-file=.dev.vars --experimental-strip-types --no-warnings scripts/e2e-sandbox.ts
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const API = process.env.E2E_API_URL ?? "http://localhost:8787";
const TOKEN = process.env.DEV_APP_TOKEN;
if (!TOKEN) throw new Error("DEV_APP_TOKEN not set (run with --env-file=.dev.vars)");
if ((process.env.PLAID_ENV ?? "sandbox") !== "sandbox") throw new Error("Sandbox only");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function call(method: string, path: string, body?: unknown, auth = true) {
  const init = {
    method,
    headers: { "content-type": "application/json", connection: "close", ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  // Local workerd sometimes resets a reused keep-alive socket after a long request; retry once.
  const res = await fetch(`${API}${path}`, init).catch(() => fetch(`${API}${path}`, init));
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

/** Read-only counts from the local D1 (wrangler d1 execute --local). */
function sql<T = Record<string, number>>(query: string): T[] {
  const res = spawnSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--env", "dev", "--json", "--command", query], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`d1 execute failed: ${res.stderr}`);
  return (JSON.parse(res.stdout) as Array<{ results: T[] }>)[0]!.results;
}
const n = (q: string) => Number(Object.values(sql(q)[0] ?? { n: 0 })[0]);

// 1. Basics and auth.
check("health is public", (await call("GET", "/health", undefined, false)).status === 200);
const unauth = await call("GET", "/connections", undefined, false);
check("unauthenticated request → empty 401", unauth.status === 401 && unauth.text === "");
const limit = await call("GET", "/connections/limit");
check("trial limit endpoint", limit.status === 200, JSON.stringify(limit.json));

// 2. Hosted Link session against real Sandbox.
const link = await call("POST", "/connections/link", {});
check("Hosted Link session created", link.status === 200 && /^https:\/\/secure\.plaid\.com\//.test(link.json?.hostedLinkUrl ?? ""), link.json?.sessionId);
const pending = await call("POST", "/connections/finalize", { sessionId: link.json?.sessionId });
check("finalize before the user finishes → pending (nothing saved)", pending.status === 202 && pending.json?.status === "pending");
const redirect = await fetch(`${API}/plaid/redirect?session=${link.json?.sessionId}`);
check("redirect page hands off to financetracker://", (await redirect.text()).includes(`financetracker://plaid-complete?session=${link.json?.sessionId}`));

// 3. Connect Sandbox banks through the same finalize code (no browser).
const itemsBefore = n("SELECT count(*) AS n FROM plaid_items");
const dynamic = await call("POST", "/dev/sandbox/connect", { institutionId: "ins_109508", username: "user_transactions_dynamic", password: "any" });
check("connect First Platypus (user_transactions_dynamic)", dynamic.json?.result?.status === "done", `accounts=${dynamic.json?.result?.accounts?.length} sync=${JSON.stringify(dynamic.json?.sync)}`);
const oauth = await call("POST", "/dev/sandbox/connect", { institutionId: "ins_127287", products: ["transactions", "investments", "liabilities"] });
check("connect Platypus OAuth Bank (ins_127287) with investments + liabilities", oauth.json?.result?.status === "done", `accounts=${oauth.json?.result?.accounts?.length} sync=${JSON.stringify(oauth.json?.sync)}`);
check("two items saved", n("SELECT count(*) AS n FROM plaid_items") === itemsBefore + 2);
const dupe = await call("POST", "/dev/sandbox/connect", { institutionId: "ins_127287", products: ["transactions"] });
check("connecting the OAuth bank again is flagged as a duplicate", dupe.json?.result?.status === "duplicate", `sameInstitution=${dupe.json?.result?.duplicates?.[0]?.sameInstitution}`);
const discard = await call("POST", "/connections/duplicate", { sessionId: dupe.json?.result?.sessionId, choice: "discard" });
check("duplicate discarded; nothing counted twice", discard.json?.status === "cancelled" && n("SELECT count(*) AS n FROM plaid_items") === itemsBefore + 2);

const dynamicItem = dynamic.json?.result?.itemId as string;
const oauthItem = oauth.json?.result?.itemId as string;
const tokenRows = sql<{ t: string }>(`SELECT access_token_enc AS t FROM plaid_items WHERE id = '${oauthItem}'`);
check("access token stored encrypted", tokenRows[0]!.t.startsWith("v1:") && !tokenRows[0]!.t.includes("access-sandbox"));

// Plaid's history can take a few seconds in Sandbox: sync until the item reports complete.
for (let i = 0; i < 10; i++) {
  const health = await call("GET", "/connections");
  const importing = (health.json?.items ?? []).filter((x: any) => [dynamicItem, oauthItem].includes(x.itemId) && x.importStatus !== "up_to_date");
  if (importing.length === 0) break;
  await new Promise((r) => setTimeout(r, 3000));
  await call("POST", "/refresh");
}

// 4. Data landed; a second sync creates no duplicates.
const txCount = n("SELECT count(*) AS n FROM transactions WHERE plaid_transaction_id IS NOT NULL");
const distinct = n("SELECT count(DISTINCT plaid_transaction_id) AS n FROM transactions WHERE plaid_transaction_id IS NOT NULL");
check("transactions imported", txCount > 0, `${txCount} Plaid transactions`);
check("investments synced (holdings, securities, activity)", n("SELECT count(*) AS n FROM holdings") > 0 && n("SELECT count(*) AS n FROM investment_transactions") > 0, `holdings=${n("SELECT count(*) AS n FROM holdings")} inv_tx=${n("SELECT count(*) AS n FROM investment_transactions")}`);
check("liabilities synced", n("SELECT count(*) AS n FROM liabilities") > 0, `${n("SELECT count(*) AS n FROM liabilities")} cards`);
check("recurring streams synced", true, `${n("SELECT count(*) AS n FROM recurring_items WHERE plaid_stream_id IS NOT NULL")} streams`);
const refresh = await call("POST", "/refresh");
const sandboxResults = (refresh.json?.items ?? []).filter((x: any) => [dynamicItem, oauthItem].includes(x.itemId));
check("Refresh reports up_to_date per Sandbox bank", sandboxResults.length === 2 && sandboxResults.every((x: any) => x.status === "up_to_date" || x.status === "rate_limited"), JSON.stringify(sandboxResults.map((x: any) => x.status)));
const seedResult = (refresh.json?.items ?? []).find((x: any) => ![dynamicItem, oauthItem].includes(x.itemId));
check("a broken bank (the seed's fake item) fails alone with its own error", !seedResult || seedResult.status === "error", seedResult ? `${seedResult.errorCode}` : "no seed item");
const txAfter = n("SELECT count(*) AS n FROM transactions WHERE plaid_transaction_id IS NOT NULL");
const distinctAfter = n("SELECT count(DISTINCT plaid_transaction_id) AS n FROM transactions WHERE plaid_transaction_id IS NOT NULL");
check("second sync: no duplicate transactions", txAfter === distinctAfter && distinct === txCount, `${txCount} → ${txAfter}`);

// 5. Daily cron: syncs and saves today's snapshots.
const accountsWithBalance = n("SELECT count(*) AS n FROM accounts WHERE current_balance_cents IS NOT NULL");
const cron = await fetch(`${API}/__scheduled?cron=${encodeURIComponent("0 11 * * *")}`);
check("daily cron ran", cron.ok);
// The scheduled handler finishes in waitUntil after /__scheduled answers: wait for the snapshots.
let snaps = 0;
for (let i = 0; i < 40 && snaps < accountsWithBalance; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  snaps = n("SELECT count(*) AS n FROM balance_snapshots WHERE source IN ('plaid','carried_forward','manual') AND date = (SELECT max(date) FROM balance_snapshots)");
}
check("daily snapshots saved for every account with a balance", snaps === accountsWithBalance, `${snaps}/${accountsWithBalance} accounts`);
await fetch(`${API}/__scheduled?cron=${encodeURIComponent("0 11 * * *")}`);
check("cron again: still no duplicate transactions", n("SELECT count(*) AS n FROM transactions WHERE plaid_transaction_id IS NOT NULL") === n("SELECT count(DISTINCT plaid_transaction_id) AS n FROM transactions WHERE plaid_transaction_id IS NOT NULL"));

// 6. Webhooks: Plaid fires a Sandbox webhook (delivered only to a public URL); local endpoint refuses unsigned ones.
const fired = await call("POST", "/dev/sandbox/fire-webhook", { itemId: dynamicItem, code: "SYNC_UPDATES_AVAILABLE" });
check("Sandbox fire_webhook accepted by Plaid", fired.json?.webhookFired === true);
const forged = await call("POST", "/plaid/webhook", { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "x" }, false);
check("unsigned webhook → empty 401", forged.status === 401 && forged.text === "");

// 7. Broken connection: Sandbox reset_login → Refresh shows the specific error and health asks to reconnect.
await call("POST", "/dev/sandbox/reset-login", { itemId: dynamicItem });
const broken = await call("POST", "/refresh");
const brokenItem = (broken.json?.items ?? []).find((x: any) => x.itemId === dynamicItem);
check("after reset_login, Refresh reports ITEM_LOGIN_REQUIRED", brokenItem?.status === "error" && brokenItem?.errorCode === "ITEM_LOGIN_REQUIRED", brokenItem?.message);
const health = await call("GET", "/connections");
const h = (health.json?.items ?? []).find((x: any) => x.itemId === dynamicItem);
check("health: needsReconnect with last updated", h?.needsReconnect === true && !!h?.lastUpdatedAt, `${h?.status} last=${h?.lastUpdatedAt} (${h?.lastUpdatedSource})`);
const update = await call("POST", "/connections/link", { itemId: dynamicItem });
check("update-mode Hosted Link session for the reconnect", update.status === 200 && update.json?.mode === "update");

// 8. Weekly backup cron writes an encrypted backup to (local) R2.
const backup = await fetch(`${API}/__scheduled?cron=${encodeURIComponent("0 12 * * SUN")}`);
check("weekly backup cron ran", backup.ok);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const root = join(import.meta.dirname, "..", "..", "..");
let dry = spawnSync("npm", ["run", "restore", "--", today, "--dry-run"], { cwd: root, encoding: "utf8" });
for (let i = 0; i < 20 && dry.status !== 0; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  dry = spawnSync("npm", ["run", "restore", "--", today, "--dry-run"], { cwd: root, encoding: "utf8" });
}
const summary = /Backup from .*/.exec(dry.stdout)?.[0] ?? dry.stderr.slice(-300);
check("backup in local R2 decrypts with BACKUP_ENC_KEY (restore --dry-run)", dry.status === 0 && /transactions=\d+/.test(summary), summary.slice(0, 160));
const intoUsed = spawnSync("npm", ["run", "restore", "--", today], { cwd: root, encoding: "utf8" });
check("restore refuses a database that already has data", intoUsed.status !== 0 && /Refusing to restore/.test(intoUsed.stderr + intoUsed.stdout));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
