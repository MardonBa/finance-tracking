import type { Context } from "hono";

/**
 * Run work after the response when the runtime allows it (ctx.waitUntil);
 * otherwise (tests calling app.request without an execution context) await it.
 */
export async function inBackground(c: Context, work: () => Promise<unknown>): Promise<void> {
  const p = work().catch((e: unknown) => console.error("background task failed:", e instanceof Error ? e.message : e));
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx) ctx.waitUntil(p);
  else await p;
}
