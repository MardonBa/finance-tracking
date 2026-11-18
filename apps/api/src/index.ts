/**
 * Finance Tracker API (Cloudflare Worker, Hono).
 *
 * Public (no credential): GET /health, POST /plaid/webhook (verified by
 * Plaid's signed JWT), GET /plaid/redirect (Hosted Link hand-off page),
 * POST /auth/google (verified Google ID token). Everything else requires a
 * bearer app token (auth.ts).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { ActionError } from "@ft/core";
import { assertConfigured, type AppEnv, type HonoEnv } from "./env.ts";
import { authRoutes, requireAppToken } from "./auth.ts";
import { NotFound, registryRoutes, todayFor } from "./routes/registry.ts";
import { plaidRoutes } from "./routes/plaid.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { syncAllItems } from "./sync/run.ts";
import { saveDailySnapshots } from "./sync/snapshots.ts";
import { runBackup } from "./backup/run.ts";

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

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// Every route below needs an app credential, except PUBLIC_PATHS (auth.ts),
// which verify their own input (Plaid signature, Google ID token).
app.use("*", requireAppToken);
app.route("/", plaidRoutes);
app.route("/", authRoutes);
app.route("/", registryRoutes);
app.route("/", connectionRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "Invalid input", issues: err.issues }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "Body must be JSON" }, 400);
  if (err instanceof ActionError) return c.json({ error: err.message }, 400);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

/** The weekly backup cron (wrangler.toml); every other cron is the daily sync. */
export const BACKUP_CRON = "0 12 * * SUN";

/**
 * Daily job: sync every bank (one failing never stops the others), then save
 * today's balance snapshot for every account.
 */
export async function runScheduled(env: AppEnv, scheduledTimeMs: number) {
  assertConfigured(env);
  const today = todayFor(env, scheduledTimeMs);
  const items = await syncAllItems(env, "cron");
  const snapshots = await saveDailySnapshots(env, today);
  const failed = items.filter((i) => i.status === "error").length;
  console.log(`daily run ${today} (${env.ENVIRONMENT}): ${items.length} items synced, ${failed} failed, ${snapshots.saved} snapshots`);
  return { today, items, snapshots };
}

/** Weekly job: encrypted backup to R2. */
export async function runWeeklyBackup(env: AppEnv, scheduledTimeMs: number) {
  assertConfigured(env);
  const result = await runBackup(env, todayFor(env, scheduledTimeMs), new Date(scheduledTimeMs).toISOString());
  console.log(`backup ${result.key}: ${result.bytes} bytes, pruned ${result.deleted.length}`);
  return result;
}

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(controller.cron === BACKUP_CRON ? runWeeklyBackup(env, controller.scheduledTime) : runScheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<AppEnv>;
