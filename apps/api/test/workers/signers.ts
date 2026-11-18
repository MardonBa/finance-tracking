/**
 * Locally generated keys standing in for Google's ID-token keys and Plaid's
 * webhook verification key, so signature checks run for real in tests.
 */
import type { PlaidWebhookJwk } from "../../src/plaid/webhook-verify.ts";

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

export async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function googleSigner(kid = "google-test-key") {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  let jwksFetches = 0;
  return {
    get jwksFetches() {
      return jwksFetches;
    },
    /** Serves {keys:[...]} like https://www.googleapis.com/oauth2/v3/certs. */
    fetch: (async () => {
      jwksFetches++;
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=21600" },
      });
    }) as typeof fetch,
    async sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
      const h = enc({ alg: "RS256", kid, typ: "JWT", ...header });
      const p = enc(claims);
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64url(sig)}`;
    },
  };
}

export async function webhookSigner(kid = "plaid-test-key") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const jwk: PlaidWebhookJwk = { alg: "ES256", crv: "P-256", kid, kty: "EC", use: "sig", x: pub.x!, y: pub.y!, created_at: 1, expired_at: null };
  let keyFetches = 0;
  return {
    jwk,
    get keyFetches() {
      return keyFetches;
    },
    fetchKey: async (_env: unknown, requested: string) => {
      keyFetches++;
      if (requested !== kid) throw new Error("unknown kid");
      return jwk;
    },
    /** The Plaid-Verification header for `body`. */
    async sign(body: string, opts: { iatS?: number; alg?: string; bodyHash?: string } = {}) {
      const h = enc({ alg: opts.alg ?? "ES256", kid, typ: "JWT" });
      const p = enc({ iat: opts.iatS ?? Math.floor(Date.now() / 1000), request_body_sha256: opts.bodyHash ?? (await sha256Hex(body)) });
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64url(sig)}`;
    },
  };
}
