/**
 * Google ID-token verification (§2 "only my Google account"). The desktop app
 * signs in with Google (OAuth + PKCE in the system browser) and sends the ID
 * token here. We check, with no Google SDK:
 *  - RS256 signature against Google's published JWKS (cached per isolate,
 *    for the Cache-Control max-age, refetched once on an unknown key id),
 *  - iss is Google, aud is our GOOGLE_CLIENT_ID, not expired,
 *  - the account is the one allowed one (ALLOWED_GOOGLE_SUB and/or
 *    ALLOWED_GOOGLE_EMAIL with email_verified).
 */
import { deps } from "./deps.ts";
import type { AppEnv } from "./env.ts";

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_S = 60;

export interface GoogleClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  exp: number;
  iat: number;
}

/** The token is not a valid Google ID token for this app (→ 401). */
export class InvalidIdToken extends Error {}

interface JwksCache {
  keys: Map<string, CryptoKey>;
  expiresAtMs: number;
}
let cache: JwksCache | null = null;

/** Tests only: forget cached keys. */
export function clearGoogleKeyCache() {
  cache = null;
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeJwtPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as T;
}

async function loadKeys(): Promise<JwksCache> {
  const res = await deps.googleFetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Array<JsonWebKey & { kid: string; alg?: string }> };
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    if (jwk.kty !== "RSA") continue;
    keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  return { keys, expiresAtMs: deps.now() + (maxAge ? Number(maxAge) : 3600) * 1000 };
}

async function keyFor(kid: string): Promise<CryptoKey | undefined> {
  if (!cache || cache.expiresAtMs <= deps.now()) cache = await loadKeys();
  let key = cache.keys.get(kid);
  if (!key) {
    // Google rotates keys; refetch once for an unknown kid.
    cache = await loadKeys();
    key = cache.keys.get(kid);
  }
  return key;
}

/** Verify signature and standard claims. Throws InvalidIdToken on any problem. */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleClaims> {
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new InvalidIdToken("malformed");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: GoogleClaims;
  try {
    header = decodeJwtPart(h);
    claims = decodeJwtPart(p);
  } catch {
    throw new InvalidIdToken("malformed");
  }
  if (header.alg !== "RS256" || !header.kid) throw new InvalidIdToken("bad header");
  const key = await keyFor(header.kid);
  if (!key) throw new InvalidIdToken("unknown key");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new InvalidIdToken("bad signature");

  const nowS = Math.floor(deps.now() / 1000);
  if (!ISSUERS.has(claims.iss)) throw new InvalidIdToken("bad issuer");
  if (claims.aud !== clientId) throw new InvalidIdToken("bad audience");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) throw new InvalidIdToken("expired");
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > nowS) throw new InvalidIdToken("issued in the future");
  if (!claims.sub) throw new InvalidIdToken("no subject");
  return claims;
}

/**
 * Only the configured account may sign in. Each configured identifier must
 * match; if neither is configured, nobody can sign in.
 */
export function isAllowedAccount(env: Pick<AppEnv, "ALLOWED_GOOGLE_SUB" | "ALLOWED_GOOGLE_EMAIL">, claims: GoogleClaims): boolean {
  const sub = env.ALLOWED_GOOGLE_SUB?.trim();
  const email = env.ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
  if (!sub && !email) return false;
  if (sub && claims.sub !== sub) return false;
  if (email) {
    const verified = claims.email_verified === true || claims.email_verified === "true";
    if (!verified || claims.email?.toLowerCase() !== email) return false;
  }
  return true;
}
