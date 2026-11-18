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
import { GeminiError } from "./gemini.ts";
import { RateLimited, runChat } from "./harness.ts";
import { BUILT_IN_PROMPTS } from "./prompts.ts";

export function rateLimitMessage(retryAt: string, scope: "minute" | "day", source: "ours" | "gemini"): string {
  const who = source === "gemini" ? "Gemini's free-tier limit was reached" : "The assistant's free-tier budget is used up";
  return `${who} for this ${scope}. It can be used again after ${retryAt}.`;
}

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
      if (e instanceof GeminiError) return c.json({ error: "ai_unavailable", message: e.message }, 502);
      throw e;
    }
  });
