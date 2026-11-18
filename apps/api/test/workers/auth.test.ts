import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/index.ts";
import { setDeps } from "../../src/deps.ts";
import { clearGoogleKeyCache } from "../../src/google.ts";
import { TOKEN, addCredential, count, request } from "./helpers.ts";
import { googleSigner } from "./signers.ts";

/**
 * The ONLY routes reachable without an app credential (§2). Each verifies its
 * own input instead and is tested separately: the webhook (webhook.test.ts),
 * the Hosted Link redirect page (connections.test.ts) and health (below).
 * POST /auth/google is NOT exempt here: without a valid Google ID token it is
 * an empty 401 like every other route.
 */
const EXEMPT = ["GET /health", "POST /plaid/webhook", "GET /plaid/redirect"];

/** Every registered route with :params filled in, so new routes are covered automatically. */
function allRoutes() {
  const seen = new Set<string>();
  return app.routes
    .filter((r) => r.method !== "ALL")
    .map((r) => ({ method: r.method, path: r.path.replace(/:([A-Za-z]+)/g, "x_$1") }))
    .filter((r) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

describe("authentication on every route (§2)", () => {
  beforeEach(async () => {
    await addCredential();
    await addCredential("revoked-token-bbbbbbbbbbbbbbbbbbbbbbbbbb", { revokedAt: "2026-11-02T00:00:00.000Z" });
    await addCredential("expired-token-cccccccccccccccccccccccccc", { expiresAt: "2026-01-01T00:00:00.000Z" });
  });

  it("knows the routes it is checking, and exempts only health, the webhook and the redirect page", () => {
    const paths = allRoutes().map((r) => `${r.method} ${r.path}`);
    for (const p of [
      "POST /q/x_name",
      "POST /a/x_name",
      "POST /actions/x_id/undo",
      "POST /auth/google",
      "POST /auth/revoke",
      "GET /auth/credentials",
      "POST /connections/link",
      "POST /connections/finalize",
      "POST /connections/duplicate",
      "GET /connections",
      "GET /connections/limit",
      "POST /refresh",
      "GET /sync/review",
    ]) {
      expect(paths).toContain(p);
    }
    for (const p of EXEMPT) expect(paths).toContain(p);
  });

  const cases: Array<[string, string | null, Record<string, string>]> = [
    ["no credential", null, {}],
    ["a malformed header", null, { authorization: "Basic abc" }],
    ["an unknown token", "unknown-token-dddddddddddddddddddddd", {}],
    ["a revoked token", "revoked-token-bbbbbbbbbbbbbbbbbbbbbbbbbb", {}],
    ["an expired token", "expired-token-cccccccccccccccccccccccccc", {}],
  ];

  for (const [label, token, headers] of cases) {
    it(`rejects ${label} with an empty 401 on every non-exempt route`, async () => {
      const routes = allRoutes().filter((r) => !EXEMPT.includes(`${r.method} ${r.path}`));
      expect(routes.length).toBeGreaterThan(14);
      for (const r of routes) {
        const res = await request(r.path, { method: r.method, token, headers, body: r.method === "GET" ? undefined : "{}" });
        expect(res.status, `${r.method} ${r.path}`).toBe(401);
        expect(await res.text(), `${r.method} ${r.path}`).toBe("");
      }
    });
  }

  it("also rejects unknown paths without a credential (no route discovery)", async () => {
    const res = await request("/nope", { token: null });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("lets a valid token through", async () => {
    const res = await request("/actions", { token: TOKEN });
    expect(res.status).toBe(200);
  });

  it("keeps the health check public and free of data", async () => {
    const res = await request("/health", { token: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "dev" });
  });

  it("never stores the token itself", async () => {
    const rows = await env.DB.prepare("SELECT token_hash FROM app_credentials").all<{ token_hash: string }>();
    for (const r of rows.results) {
      expect(r.token_hash).not.toContain("token");
      expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("DEV_APP_TOKEN (local dev only)", () => {
  const DEV = "dev_test_token_aaaaaaaaaaaaaaaaaaaaaaaa";

  it("is accepted when ENVIRONMENT is dev", async () => {
    expect((await request("/actions", { token: DEV })).status).toBe(200);
  });

  it("is rejected in production, even if the secret were set there", async () => {
    const res = await request("/actions", { token: DEV, envOverrides: { ENVIRONMENT: "production", DEV_APP_TOKEN: DEV } });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("does not open anything when unset or too short", async () => {
    expect((await request("/actions", { token: DEV, envOverrides: { DEV_APP_TOKEN: "" } })).status).toBe(401);
    expect((await request("/actions", { token: "short_but_valid_shape_1234", envOverrides: { DEV_APP_TOKEN: "short" } })).status).toBe(401);
  });
});

describe("Google sign-in (§2, §3 step 1)", () => {
  let signer: Awaited<ReturnType<typeof googleSigner>>;
  let restore: () => void;
  const nowS = () => Math.floor(Date.now() / 1000);
  const claims = (over: Record<string, unknown> = {}) => ({
    iss: "https://accounts.google.com",
    aud: "test-google-client",
    sub: "1234567890",
    email: "me@example.com",
    email_verified: true,
    iat: nowS() - 10,
    exp: nowS() + 3600,
    ...over,
  });
  const signIn = (idToken: string, label?: string) => request("/auth/google", { method: "POST", token: null, body: JSON.stringify({ idToken, label }) });

  beforeEach(async () => {
    clearGoogleKeyCache();
    signer = await googleSigner();
    restore = setDeps({ googleFetch: signer.fetch });
  });
  afterEach(() => restore());

  it("issues a working, hashed, expiring app credential for the allowed account", async () => {
    const res = await signIn(await signer.sign(claims()), "MacBook");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: string; credentialId: string };
    expect(body.token).toMatch(/^ft_[A-Za-z0-9_-]{40,}$/);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now() + 80 * 86_400_000);
    const stored = await env.DB.prepare("SELECT token_hash, label, expires_at FROM app_credentials WHERE id = ?").bind(body.credentialId).first<Record<string, string>>();
    expect(stored?.label).toBe("MacBook");
    expect(stored?.token_hash).not.toContain(body.token);
    expect((await request("/actions", { token: body.token })).status).toBe(200);
  });

  it("refuses any other Google account with 403 and creates nothing", async () => {
    for (const over of [
      { sub: "999", email: "someone@example.com" },
      { email: "someone@example.com" },
      { sub: "999" },
      { email_verified: false },
    ]) {
      const res = await signIn(await signer.sign(claims(over)));
      expect(res.status, JSON.stringify(over)).toBe(403);
    }
    expect(await count("app_credentials")).toBe(0);
  });

  it("refuses everyone when no account is configured", async () => {
    const res = await request("/auth/google", {
      method: "POST",
      token: null,
      body: JSON.stringify({ idToken: await signer.sign(claims()) }),
      envOverrides: { ALLOWED_GOOGLE_SUB: "", ALLOWED_GOOGLE_EMAIL: "" },
    });
    expect(res.status).toBe(403);
    expect(await count("app_credentials")).toBe(0);
  });

  it("rejects invalid ID tokens with an empty 401", async () => {
    const other = await googleSigner("other-key");
    const bad = [
      await signer.sign(claims({ aud: "someone-elses-client" })),
      await signer.sign(claims({ iss: "https://evil.example" })),
      await signer.sign(claims({ exp: nowS() - 3600 })),
      await signer.sign(claims(), { alg: "HS256" }),
      await other.sign(claims()), // unknown key id
      (await signer.sign(claims())).replace(/\.[^.]+$/, ".AAAA"), // bad signature
      "not-a-jwt-at-all-but-long-enough",
    ];
    for (const token of bad) {
      const res = await signIn(token);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
    }
    expect(await count("app_credentials")).toBe(0);
  });

  it("caches Google's keys between sign-ins", async () => {
    await signIn(await signer.sign(claims()));
    await signIn(await signer.sign(claims()));
    expect(signer.jwksFetches).toBe(1);
  });

  it("revokes the current credential immediately, or all of them", async () => {
    const a = ((await (await signIn(await signer.sign(claims()), "A")).json()) as { token: string }).token;
    const b = ((await (await signIn(await signer.sign(claims()), "B")).json()) as { token: string }).token;
    const c = ((await (await signIn(await signer.sign(claims()), "C")).json()) as { token: string }).token;

    const list = (await (await request("/auth/credentials", { token: a })).json()) as { credentials: Array<{ label: string; current: boolean }> };
    expect(list.credentials.find((x) => x.current)?.label).toBe("A");

    const r1 = await request("/auth/revoke", { method: "POST", token: a });
    expect(await r1.json()).toEqual({ revoked: 1 });
    expect((await request("/actions", { token: a })).status).toBe(401);
    expect((await request("/actions", { token: b })).status).toBe(200);

    await request("/auth/revoke", { method: "POST", token: b, body: JSON.stringify({ all: true }) });
    expect((await request("/actions", { token: b })).status).toBe(401);
    expect((await request("/actions", { token: c })).status).toBe(401);
  });
});

describe("CORS", () => {
  it("answers the desktop app's preflight without a credential and refuses other origins", async () => {
    const ok = await request("/q/example.sumTransactions", {
      method: "OPTIONS",
      token: null,
      headers: { origin: "http://localhost:1420", "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    const other = await request("/health", { token: null, headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
