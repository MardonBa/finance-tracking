/**
 * Plaid webhook verification (§2 "Plaid webhooks are verified before the
 * backend acts on them"), following Plaid's documented scheme:
 *  1. The `Plaid-Verification` header is a JWT; its header must say ES256 and
 *     name a key id (kid).
 *  2. The public key comes from /webhook_verification_key/get (cached per
 *     isolate by kid; an expired key is refused).
 *  3. The ES256 signature must verify.
 *  4. The payload's iat must be within 5 minutes of now (no replays).
 *  5. The payload's request_body_sha256 must equal SHA-256 of the raw body.
 */
import { b64urlDecode, decodeJwtPart } from "../google.ts";

export interface PlaidWebhookJwk {
  alg: string;
  crv: string;
  kid: string;
  kty: string;
  use: string;
  x: string;
  y: string;
  created_at: number;
  expired_at: number | null;
}

export type WebhookKeyFetcher = (kid: string) => Promise<PlaidWebhookJwk>;

export const WEBHOOK_MAX_AGE_S = 5 * 60;

const keyCache = new Map<string, { key: CryptoKey; expiredAt: number | null }>();

/** Tests only. */
export function clearWebhookKeyCache() {
  keyCache.clear();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function keyFor(kid: string, fetchKey: WebhookKeyFetcher, nowS: number): Promise<CryptoKey | null> {
  let entry = keyCache.get(kid);
  if (!entry) {
    const jwk = await fetchKey(kid);
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || jwk.kid !== kid) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    entry = { key, expiredAt: jwk.expired_at };
    keyCache.set(kid, entry);
  }
  if (entry.expiredAt !== null && entry.expiredAt <= nowS) return null;
  return entry.key;
}

/** True only when every check passes. Never throws for bad input. */
export async function verifyPlaidWebhook(rawBody: string, jwt: string | null | undefined, fetchKey: WebhookKeyFetcher, nowMs: number): Promise<boolean> {
  try {
    if (!jwt) return false;
    const parts = jwt.split(".");
    if (parts.length !== 3) return false;
    const [h, p, s] = parts as [string, string, string];
    const header = decodeJwtPart<{ alg?: string; kid?: string }>(h);
    if (header.alg !== "ES256" || !header.kid) return false;
    const nowS = Math.floor(nowMs / 1000);
    const key = await keyFor(header.kid, fetchKey, nowS);
    if (!key) return false;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return false;
    const payload = decodeJwtPart<{ iat?: number; request_body_sha256?: string }>(p);
    if (typeof payload.iat !== "number" || Math.abs(nowS - payload.iat) > WEBHOOK_MAX_AGE_S) return false;
    if (typeof payload.request_body_sha256 !== "string") return false;
    return timingSafeEqual(await sha256Hex(rawBody), payload.request_body_sha256);
  } catch {
    return false;
  }
}
