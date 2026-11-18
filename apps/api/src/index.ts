/**
 * Finance Tracker API (Cloudflare Worker, Hono).
 *
 * Public (no credential): GET /health, POST /plaid/webhook (verified by
 * Plaid's signature, backend track), GET /plaid/redirect (Hosted Link hand-off
 * page). Everything else requires a bearer app token (auth.ts).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { ActionError } from "@ft/core";
import { assertConfigured, type AppEnv, type HonoEnv } from "./env.ts";
import { requireAppToken } from "./auth.ts";
import { NotFound, registryRoutes, todayFor } from "./routes/registry.ts";

export const app = new Hono<HonoEnv>();

app.use("*", async (c, next) => {
  try {
    assertConfigured(c.env);
  } catch {
    return c.text("Worker not configured", 500);
  }
  return next();
});

/** The desktop webview: Vite in dev, Tauri's own scheme in the built app. */
export const ALLOWED_ORIGINS = ["http://localhost:1420", "tauri://localhost", "http://tauri.localhost"];
app.use("*", cors({ origin: ALLOWED_ORIGINS, allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 600 }));

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT}));

// Placeholders for the backend track (Phase 1). Public by design; they must
// verify their own inputs (Plaid webhook signature) before acting.
app.post("/plaid/webhook", (c) => c.body(null, 501));
app.get("/plaid/redirect", (c) =>
  c.html(
    `<!doctype html><meta charset="utf-8"><title>Finance Tracker</title>` +
      `<p>Returning to Finance Tracker… <a href="financetracker://plaid-complete">Open the app</a></p>` +
      `<script>location.href="financetracker://plaid-complete"</script>`,
  ),
);

app.use("*", requireAppToken);
app.route("/", registryRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "Invalid input", issues: err.issues }, 400);
  if (err instanceof ActionError) return c.json({ error: err.message }, 400);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

/** Daily job (wrangler.toml crons). The backend track fills in sync, snapshots and backups. */
export async function runScheduled(env: AppEnv, scheduledTimeMs: number): Promise<{ today: string }> {
  assertConfigured(env);
  const today = todayFor(env, scheduledTimeMs);
  console.log(`scheduled run for ${today} (${env.ENVIRONMENT}): nothing to do yet`);
  return { today };
}

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<AppEnv>;
