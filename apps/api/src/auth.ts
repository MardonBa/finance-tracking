/**
 * App-token authentication (stub for Phase 1's backend track, which adds the
 * Google sign-in that issues tokens). Every route except the public ones
 * requires `Authorization: Bearer <token>`; the token's HMAC (keyed with
 * APP_TOKEN_PEPPER) must match a non-revoked, non-expired app_credentials row.
 * Failures return 401 with an EMPTY body: no data, no reason (§2).
 */
import { createMiddleware } from "hono/factory";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { HonoEnv } from "./env.ts";
import { appCredentials } from "./db/schema.ts";

/** Paths reachable without a credential. Everything else is authenticated. */
export const PUBLIC_PATHS: readonly string[] = ["/health", "/plaid/webhook", "/plaid/redirect"];

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

export const unauthorized = () => new Response(null, { status: 401 });

export const requireAppToken = createMiddleware<HonoEnv>(async (c, next) => {
  if (PUBLIC_PATHS.includes(c.req.path)) return next();
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{20,512})$/.exec(header);
  if (!match?.[1]) return unauthorized();
  let hash: string;
  try {
    hash = await hashAppToken(match[1], c.env.APP_TOKEN_PEPPER);
  } catch {
    return unauthorized();
  }
  const db = drizzle(c.env.DB);
  const row = await db
    .select({ id: appCredentials.id, expiresAt: appCredentials.expiresAt })
    .from(appCredentials)
    .where(and(eq(appCredentials.tokenHash, hash), isNull(appCredentials.revokedAt)))
    .get();
  if (!row) return unauthorized();
  if (row.expiresAt && row.expiresAt <= new Date().toISOString()) return unauthorized();
  c.set("credentialId", row.id);
  return next();
});
