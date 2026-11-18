/**
 * Our own Gemini request budget, kept in D1 (`ai_rate_counters`) so the
 * assistant stops politely before Google's free-tier limit instead of after.
 *
 * Buckets:
 *   rpm:<YYYY-MM-DDTHH:MM>  requests in that UTC minute
 *   rpd:<YYYY-MM-DD>        requests on that Pacific-time day (Gemini's daily quota resets at midnight PT)
 *   cooldown:<model>        set from a Gemini 429's retryDelay; the model isn't called again before reset_at
 */
import type { AppEnv } from "../env.ts";

/**
 * TODO(revisit): free-tier limits for gemini-2.5-flash. Google no longer
 * publishes per-model numbers (AI Studio shows them per project); reports in
 * 2026 range from 10 RPM / 250 RPD down to 20 RPD after the Dec 2025 cuts.
 * Override with AI_RPM_LIMIT / AI_RPD_LIMIT in wrangler.toml; a real 429 from
 * Google is handled anyway (cooldown from retryDelay).
 */
export const DEFAULT_RPM_LIMIT = 10;
export const DEFAULT_RPD_LIMIT = 250;

export interface Limits {
  rpm: number;
  rpd: number;
}

export function limitsFor(env: Pick<AppEnv, "AI_RPM_LIMIT" | "AI_RPD_LIMIT">): Limits {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return { rpm: n(env.AI_RPM_LIMIT, DEFAULT_RPM_LIMIT), rpd: n(env.AI_RPD_LIMIT, DEFAULT_RPD_LIMIT) };
}

const PACIFIC = "America/Los_Angeles";

function pacificParts(nowMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, h: Number(get("hour")), m: Number(get("minute")), s: Number(get("second")) };
}

export function windows(nowMs: number) {
  const minuteStart = Math.floor(nowMs / 60_000) * 60_000;
  const pt = pacificParts(nowMs);
  const msIntoDay = ((pt.h * 60 + pt.m) * 60 + pt.s) * 1000 + (nowMs % 1000);
  return {
    rpm: { bucket: `rpm:${new Date(minuteStart).toISOString().slice(0, 16)}`, resetAt: new Date(minuteStart + 60_000).toISOString() },
    rpd: { bucket: `rpd:${pt.date}`, resetAt: new Date(nowMs - msIntoDay + 86_400_000).toISOString() },
  };
}

export interface Blocked {
  /** "ours": our own counter; "gemini": Google said 429. */
  source: "ours" | "gemini";
  scope: "minute" | "day";
  retryAt: string;
}

async function getRow(db: D1Database, bucket: string) {
  return db.prepare("SELECT count, reset_at AS resetAt FROM ai_rate_counters WHERE bucket = ?").bind(bucket).first<{ count: number; resetAt: string }>();
}

/** Is a Gemini call allowed right now? Returns why not (and until when) if it isn't. */
export async function checkBudget(db: D1Database, nowMs: number, limits: Limits): Promise<Blocked | null> {
  const w = windows(nowMs);
  const [rpd, rpm] = await Promise.all([getRow(db, w.rpd.bucket), getRow(db, w.rpm.bucket)]);
  if (rpd && rpd.count >= limits.rpd) return { source: "ours", scope: "day", retryAt: w.rpd.resetAt };
  if (rpm && rpm.count >= limits.rpm) return { source: "ours", scope: "minute", retryAt: w.rpm.resetAt };
  return null;
}

/** Count one Gemini request in the minute and day buckets (and prune old buckets). */
export async function recordRequest(db: D1Database, nowMs: number): Promise<void> {
  const w = windows(nowMs);
  const upsert = "INSERT INTO ai_rate_counters (bucket, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1";
  await db.batch([
    db.prepare(upsert).bind(w.rpm.bucket, w.rpm.resetAt),
    db.prepare(upsert).bind(w.rpd.bucket, w.rpd.resetAt),
    db.prepare("DELETE FROM ai_rate_counters WHERE reset_at < ?").bind(new Date(nowMs - 2 * 86_400_000).toISOString()),
  ]);
}

/** When a model may be called again after a Gemini 429, or null. */
export async function cooldownUntil(db: D1Database, model: string, nowMs: number): Promise<string | null> {
  const row = await getRow(db, `cooldown:${model}`);
  return row && Date.parse(row.resetAt) > nowMs ? row.resetAt : null;
}

export async function setCooldown(db: D1Database, model: string, untilIso: string): Promise<void> {
  await db
    .prepare("INSERT INTO ai_rate_counters (bucket, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1, reset_at = excluded.reset_at")
    .bind(`cooldown:${model}`, untilIso)
    .run();
}

/** Until when to back off after a Gemini 429: its retryDelay, else the next PT midnight for a daily quota, else one minute. */
export function cooldownFrom(nowMs: number, retryAfterMs: number | null, perDay: boolean): string {
  if (retryAfterMs !== null && retryAfterMs > 0) return new Date(nowMs + retryAfterMs).toISOString();
  if (perDay) return windows(nowMs).rpd.resetAt;
  return new Date(nowMs + 60_000).toISOString();
}
