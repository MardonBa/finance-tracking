/**
 * App-token authentication (§2 "Only I can get in").
 *
 * - POST /auth/google: the desktop app sends a Google ID token; only the one
 *   allowed account gets an app credential (a random token, stored only as
 *   HMAC-SHA256(APP_TOKEN_PEPPER, token), with an expiry). Any other account
 *   gets 403 and nothing is created.
 * - Every other non-public route requires `Authorization: Bearer <token>`
 *   matching a non-revoked, non-expired app_credentials row.
 * - POST /auth/revoke revokes the current credential (or all of them);
 *   revoked credentials fail on the very next request.
 * - DEV_APP_TOKEN (local dev convenience) is honoured ONLY when
 *   ENVIRONMENT is "dev". Production ignores it.
 *
 * Every authentication failure is 401 with an EMPTY body: no data, no reason.
 */
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { HonoEnv } from "./env.ts";
import { appCredentials } from "./db/schema.ts";
import { deps, newId, nowIso } from "./deps.ts";
import { InvalidIdToken, isAllowedAccount, verifyGoogleIdToken } from "./google.ts";

/**
 * Paths reachable without an app credential. Each verifies its own input:
 * the webhook checks Plaid's signature, /auth/google checks the Google ID
 * token (401 with an empty body when it is missing or invalid), the redirect
 * page and health check return no data.
 */
export const PUBLIC_PATHS: readonly string[] = ["/health", "/plaid/webhook", "/plaid/redirect", "/auth/google"];

/** How long an app credential lasts before Google sign-in is needed again. TODO(revisit): 90 days (§3 Open). */
export const APP_TOKEN_TTL_DAYS = 90;
/** last_used_at is written at most this often, to save D1 writes. */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;
const DEV_CREDENTIAL_ID = "dev";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256(pepper, token) as hex: what app_credentials.token_hash stores. */
export async function hashAppToken(token: string, pepper: string): Promise<string> {
  if (!pepper) throw new Error("APP_TOKEN_PEPPER is not set");
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(token)));
}

/** A new random app token (256 bits, URL-safe). */
export function generateAppToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `ft_${btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export const unauthorized = () => new Response(null, { status: 401 });

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,512})$/;

export const requireAppToken = createMiddleware<HonoEnv>(async (c, next) => {
  if (PUBLIC_PATHS.includes(c.req.path)) return next();
  const match = BEARER.exec(c.req.header("authorization") ?? "");
  if (!match?.[1]) return unauthorized();
  let hash: string;
  try {
    hash = await hashAppToken(match[1], c.env.APP_TOKEN_PEPPER);
  } catch {
    return unauthorized();
  }

  // Local dev only: the token written by scripts/sync-dev-vars.mjs. Compared as
  // HMACs so the comparison does not leak timing about the token.
  if (c.env.ENVIRONMENT === "dev" && c.env.DEV_APP_TOKEN && c.env.DEV_APP_TOKEN.length >= 20) {
    if (hash === (await hashAppToken(c.env.DEV_APP_TOKEN, c.env.APP_TOKEN_PEPPER))) {
      c.set("credentialId", DEV_CREDENTIAL_ID);
      return next();
    }
  }

  const db = drizzle(c.env.DB);
  const row = await db
    .select({ id: appCredentials.id, expiresAt: appCredentials.expiresAt, lastUsedAt: appCredentials.lastUsedAt })
    .from(appCredentials)
    .where(and(eq(appCredentials.tokenHash, hash), isNull(appCredentials.revokedAt)))
    .get();
  if (!row) return unauthorized();
  const now = nowIso();
  if (row.expiresAt && row.expiresAt <= now) return unauthorized();
  if (!row.lastUsedAt || Date.parse(row.lastUsedAt) + LAST_USED_RESOLUTION_MS < deps.now()) {
    await db.update(appCredentials).set({ lastUsedAt: now }).where(eq(appCredentials.id, row.id));
  }
  c.set("credentialId", row.id);
  return next();
});

const signInBody = z.object({
  idToken: z.string().min(20).max(8192),
  label: z.string().trim().min(1).max(60).optional(),
});

const revokeBody = z.object({
  all: z.boolean().optional(),
  credentialId: z.string().max(100).optional(),
});

export const authRoutes = new Hono<HonoEnv>()
  /** Exchange a Google ID token for an app credential (only the allowed account). */
  .post("/auth/google", async (c) => {
    const parsed = signInBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return unauthorized();
    let claims;
    try {
      claims = await verifyGoogleIdToken(parsed.data.idToken, c.env.GOOGLE_CLIENT_ID);
    } catch (e) {
      if (e instanceof InvalidIdToken) return unauthorized();
      throw e;
    }
    if (!isAllowedAccount(c.env, claims)) return c.json({ error: "forbidden" }, 403);

    const token = generateAppToken();
    const now = deps.now();
    const credentialId = newId("cred");
    const expiresAt = new Date(now + APP_TOKEN_TTL_DAYS * 86_400_000).toISOString();
    await drizzle(c.env.DB)
      .insert(appCredentials)
      .values({
        id: credentialId,
        tokenHash: await hashAppToken(token, c.env.APP_TOKEN_PEPPER),
        label: parsed.data.label ?? "desktop",
        createdAt: new Date(now).toISOString(),
        expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      });
    return c.json({ token, expiresAt, credentialId });
  })
  /** Revoke the current credential (default), one by id, or all of them. */
  .post("/auth/revoke", async (c) => {
    const text = await c.req.text();
    let body: z.infer<typeof revokeBody> = {};
    if (text.trim()) {
      const parsed = revokeBody.safeParse(JSON.parse(text));
      if (!parsed.success) return c.json({ error: "Invalid input" }, 400);
      body = parsed.data;
    }
    const db = drizzle(c.env.DB);
    const now = nowIso();
    const target = body.all
      ? isNull(appCredentials.revokedAt)
      : and(eq(appCredentials.id, body.credentialId ?? c.get("credentialId")), isNull(appCredentials.revokedAt));
    const res = await db.update(appCredentials).set({ revokedAt: now }).where(target).run();
    return c.json({ revoked: res.meta.changes ?? 0 });
  })
  /** Credentials issued (no hashes), to choose what to revoke. */
  .get("/auth/credentials", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select({
        id: appCredentials.id,
        label: appCredentials.label,
        createdAt: appCredentials.createdAt,
        expiresAt: appCredentials.expiresAt,
        lastUsedAt: appCredentials.lastUsedAt,
      })
      .from(appCredentials)
      .where(isNull(appCredentials.revokedAt))
      .all();
    const current = c.get("credentialId");
    const now = nowIso();
    const live = rows.filter((r) => !r.expiresAt || r.expiresAt > now);
    return c.json({ credentials: live.map((r) => ({ ...r, current: r.id === current })) });
  });
