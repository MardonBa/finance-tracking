/**
 * DEV + SANDBOX ONLY helpers for the headless end-to-end run
 * (docs/planning/plaid-hosted-link-spike.md). They need an app credential
 * like every route, and answer 404 unless ENVIRONMENT is "dev" AND
 * PLAID_ENV is "sandbox"; the Plaid client additionally refuses
 * Sandbox-only endpoints outside Sandbox.
 *
 *   POST /dev/sandbox/connect       {institutionId?, username?, password?, products?}
 *        create a Link session (real /link/token/create), then finish it with a
 *        Sandbox public token through the same code as a real Hosted Link result
 *   POST /dev/sandbox/fire-webhook  {itemId, code}  /sandbox/item/fire_webhook
 *   POST /dev/sandbox/reset-login   {itemId}        /sandbox/item/reset_login
 */
import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../env.ts";
import { plaidFor } from "../deps.ts";
import { createLinkSession, finalizeWithPublicToken } from "../connections/link.ts";
import { accessTokenFor, loadItem } from "../sync/accounts.ts";
import { syncItem } from "../sync/run.ts";

const connectBody = z.object({
  institutionId: z.string().default("ins_109508"),
  username: z.string().optional(),
  password: z.string().optional(),
  products: z.array(z.enum(["transactions", "investments", "liabilities"])).default(["transactions"]),
});

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  return text.trim() ? JSON.parse(text) : {};
}

export const devRoutes = new Hono<HonoEnv>()
  .use("/dev/*", async (c, next) => {
    if (c.env.ENVIRONMENT !== "dev" || c.env.PLAID_ENV !== "sandbox") return c.json({ error: "Not found" }, 404);
    return next();
  })
  .post("/dev/sandbox/connect", async (c) => {
    const input = connectBody.parse(await body(c.req.raw));
    const plaid = plaidFor(c.env);
    const session = await createLinkSession(c.env, {});
    const base = c.env.PUBLIC_API_URL.replace(/\/+$/, "");
    const created = await plaid.call("/sandbox/public_token/create", {
      institution_id: input.institutionId,
      initial_products: input.products,
      options: {
        ...(input.username ? { override_username: input.username, override_password: input.password ?? "pass_good" } : {}),
        transactions: { days_requested: 730 },
        // Plaid only fires Sandbox webhooks for items with a webhook URL. Local wrangler dev is not
        // reachable, so use a reserved .invalid host (never resolves, reaches no one) to prove the firing.
        webhook: base.startsWith("https://") ? `${base}/plaid/webhook` : "https://unreachable-local-dev.invalid/plaid/webhook",
      },
    });
    const { result, newItemId } = await finalizeWithPublicToken(c.env, session.sessionId, created.public_token);
    const sync = newItemId ? await syncItem(c.env, newItemId, { trigger: "initial" }) : null;
    return c.json({ hostedLinkUrlCreated: !!session.hostedLinkUrl, result, sync });
  })
  .post("/dev/sandbox/fire-webhook", async (c) => {
    const { itemId, code } = z.object({ itemId: z.string(), code: z.string() }).parse(await body(c.req.raw));
    const item = await loadItem(c.env, itemId);
    if (!item) return c.json({ error: "Unknown item" }, 404);
    const res = await plaidFor(c.env).call("/sandbox/item/fire_webhook", { access_token: await accessTokenFor(c.env, item), webhook_code: code as never });
    return c.json({ webhookFired: res.webhook_fired });
  })
  .post("/dev/sandbox/reset-login", async (c) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(await body(c.req.raw));
    const item = await loadItem(c.env, itemId);
    if (!item) return c.json({ error: "Unknown item" }, 404);
    const res = await plaidFor(c.env).call("/sandbox/item/reset_login", { access_token: await accessTokenFor(c.env, item) });
    return c.json({ resetLogin: res.reset_login });
  });
