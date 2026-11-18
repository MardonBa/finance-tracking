/**
 *   POST /ai/chat     one assistant turn (the client sends the whole conversation; nothing is stored)
 *   GET  /ai/prompts  the built-in questions for the app's chips
 *
 * The AI runs ONLY here, when the user asks (decision 006): no sync, cron or
 * page-load path imports the harness (asserted in test/node/ai-static.test.ts).
 * Approving a proposal is a normal POST /a/:name?source=ai, so it's in the
 * action log and can be undone.
 */
import { Hono } from "hono";
import type { HonoEnv } from "../env.ts";
import { ModelError } from "./claude.ts";
import { RateLimited, runChat } from "./harness.ts";
import { BUILT_IN_PROMPTS } from "./prompts.ts";

export function rateLimitMessage(retryAt: string, scope: "minute" | "day", source: "ours" | "provider"): string {
  const who = source === "provider" ? "The Claude API is rate-limiting the assistant" : `The assistant's request budget for this ${scope} is used up`;
  return `${who}. It can be used again after ${retryAt}.`;
}

export const CREDITS_MESSAGE =
  "The Claude API credit balance is used up, so the assistant can't answer. Add credits in the Claude Console (Billing), or wait for next month's plan credits. Everything else keeps working.";

export const aiRoutes = new Hono<HonoEnv>()
  .get("/ai/prompts", (c) => c.json({ prompts: BUILT_IN_PROMPTS.map(({ id, label }) => ({ id, label })) }))
  .post("/ai/chat", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Body must be JSON" }, 400);
    }
    try {
      return c.json(await runChat(c.env, body));
    } catch (e) {
      if (e instanceof RateLimited) {
        const { retryAt, scope, source } = e.blocked;
        const retryAfterS = Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000));
        c.header("retry-after", String(retryAfterS));
        return c.json({ error: "rate_limited", source, scope, retryAt, message: rateLimitMessage(retryAt, scope, source) }, 429);
      }
      if (e instanceof ModelError) {
        if (e.kind === "credits") return c.json({ error: "ai_credits", message: CREDITS_MESSAGE }, 503);
        console.error(e.message);
        return c.json({ error: "ai_unavailable", message: e.kind === "config" ? "The assistant isn't set up correctly (Claude API key or model)." : "The assistant is unavailable right now. Try again in a minute." }, 502);
      }
      throw e;
    }
  });
