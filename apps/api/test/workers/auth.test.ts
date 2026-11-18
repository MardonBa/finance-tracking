import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_PATHS } from "../../src/auth.ts";
import { app } from "../../src/index.ts";
import { TOKEN, addCredential, request } from "./helpers.ts";

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

  it("knows the routes it is checking", () => {
    const paths = allRoutes().map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("POST /q/x_name");
    expect(paths).toContain("POST /a/x_name");
    expect(paths).toContain("POST /actions/x_id/undo");
  });

  const cases: Array<[string, string | null, Record<string, string>]> = [
    ["no credential", null, {}],
    ["a malformed header", null, { authorization: "Basic abc" }],
    ["an unknown token", "unknown-token-dddddddddddddddddddddd", {}],
    ["a revoked token", "revoked-token-bbbbbbbbbbbbbbbbbbbbbbbbbb", {}],
    ["an expired token", "expired-token-cccccccccccccccccccccccccc", {}],
  ];

  for (const [label, token, headers] of cases) {
    it(`rejects ${label} with an empty 401 on every non-public route`, async () => {
      const routes = allRoutes().filter((r) => !PUBLIC_PATHS.includes(r.path));
      expect(routes.length).toBeGreaterThan(4);
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
