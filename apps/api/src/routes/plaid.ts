/**
 * Public Plaid endpoints (no app credential; each verifies its own input):
 *
 *   POST /plaid/webhook   Plaid's webhooks. The signed JWT is verified FIRST
 *                         (plaid/webhook-verify.ts); unverified → 401, no action.
 *   GET  /plaid/redirect  Hosted Link's completion_redirect_uri: a tiny page
 *                         that hands off to financetracker://plaid-complete.
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { AppEnv, HonoEnv } from "../env.ts";
import { plaidItems } from "../db/schema.ts";
import { deps } from "../deps.ts";
import { verifyPlaidWebhook } from "../plaid/webhook-verify.ts";
import { finalizeSession, sessionIdForLinkToken } from "../connections/link.ts";
import { syncItem, type SyncScope } from "../sync/run.ts";
import { statusForError, isTransient } from "../sync/status.ts";
import { inBackground } from "./background.ts";
import { unauthorized } from "../auth.ts";

const webhookSchema = z.looseObject({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().nullish(),
  error: z.object({ error_code: z.string() }).nullish(),
  consent_expiration_time: z.string().nullish(),
  link_token: z.string().nullish(),
  status: z.string().nullish(),
});
export type PlaidWebhook = z.infer<typeof webhookSchema>;

/** What a verified webhook does. Exported for tests. */
export async function handleWebhook(env: AppEnv, hook: PlaidWebhook): Promise<string> {
  const { webhook_type: type, webhook_code: code } = hook;

  if (type === "LINK" && code === "SESSION_FINISHED") {
    if (!hook.link_token) return "ignored";
    const sessionId = await sessionIdForLinkToken(env, hook.link_token);
    if (!sessionId) return "ignored";
    const { newItemId, repairedItemId } = await finalizeSession(env, sessionId);
    if (newItemId) await syncItem(env, newItemId, { trigger: "initial" });
    if (repairedItemId) await syncItem(env, repairedItemId, { trigger: "webhook" });
    return "session_finalized";
  }

  if (!hook.item_id) return "ignored";
  const db = drizzle(env.DB);
  const item = await db.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.plaidItemId, hook.item_id)).get();
  if (!item) return "unknown_item";
  const set = (values: Partial<typeof plaidItems.$inferInsert>) => db.update(plaidItems).set(values).where(eq(plaidItems.id, item.id));
  const sync = async (scope: SyncScope) => {
    await syncItem(env, item.id, { trigger: "webhook", scope });
    return `synced_${scope}`;
  };

  switch (`${type}:${code}`) {
    case "TRANSACTIONS:SYNC_UPDATES_AVAILABLE":
      return sync("transactions");
    case "TRANSACTIONS:RECURRING_TRANSACTIONS_UPDATE":
      return sync("recurring");
    case "HOLDINGS:DEFAULT_UPDATE":
    case "INVESTMENTS_TRANSACTIONS:DEFAULT_UPDATE":
    case "INVESTMENTS_TRANSACTIONS:HISTORICAL_UPDATE":
      return sync("investments");
    case "LIABILITIES:DEFAULT_UPDATE":
      return sync("liabilities");
    case "ITEM:ERROR": {
      const errorCode = hook.error?.error_code;
      if (!errorCode || isTransient(errorCode)) return "ignored";
      await set({ status: statusForError(errorCode), errorCode });
      return "status_updated";
    }
    case "ITEM:LOGIN_REPAIRED":
      await set({ status: "ok", errorCode: null });
      return "status_updated";
    case "ITEM:PENDING_EXPIRATION":
      await set({ status: "pending_expiration", errorCode: "PENDING_EXPIRATION", consentExpiresAt: hook.consent_expiration_time ?? null });
      return "status_updated";
    case "ITEM:PENDING_DISCONNECT":
      await set({ status: "pending_expiration", errorCode: "PENDING_DISCONNECT" });
      return "status_updated";
    case "ITEM:USER_PERMISSION_REVOKED":
    case "ITEM:USER_ACCOUNT_REVOKED":
      await set({ status: "revoked", errorCode: code });
      return "status_updated";
    default:
      return "ignored";
  }
}

/** Our session ids are `ls_` + 32 hex characters; anything else is refused. */
const SESSION_ID = /^ls_[0-9a-f]{32}$/;

export function redirectPage(sessionId: string | null): string {
  const target = sessionId ? `financetracker://plaid-complete?session=${sessionId}` : "financetracker://plaid-complete";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Finance Tracker</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center;color:#222}a{color:#2456d6}</style>
</head><body>
<h1>Bank connected</h1>
<p>Returning to Finance Tracker… You can close this tab.</p>
<p><a id="open" href="${target}">Open Finance Tracker</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;
}

export const plaidRoutes = new Hono<HonoEnv>()
  .post("/plaid/webhook", async (c) => {
    const raw = await c.req.text();
    const verified = await verifyPlaidWebhook(raw, c.req.header("plaid-verification"), (kid) => deps.plaidWebhookKey(c.env, kid), deps.now());
    if (!verified) return unauthorized();
    const parsed = webhookSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return c.body(null, 200); // verified but not a shape we act on
    await inBackground(c, () => handleWebhook(c.env, parsed.data));
    return c.body(null, 200);
  })
  .get("/plaid/redirect", (c) => {
    const raw = c.req.query("session") ?? null;
    const sessionId = raw && SESSION_ID.test(raw) ? raw : null;
    c.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    c.header("referrer-policy", "no-referrer");
    c.header("cache-control", "no-store");
    return c.html(redirectPage(sessionId));
  });
