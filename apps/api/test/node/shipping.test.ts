/**
 * §1 "Tests run with one command and must pass before a change ships":
 * every `ship:*` script in the root package.json runs `ship:check` (typecheck
 * + the whole `npm test`, Rust included) first, and docs/shipping.md tells you
 * to use those scripts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const shipping = readFileSync(join(ROOT, "docs/shipping.md"), "utf8");

describe("shipping is gated on the tests (§1)", () => {
  it("npm test runs every workspace's tests and cargo test", () => {
    expect(scripts.test).toBe("npm run test:ts && npm run test:rust");
    expect(scripts["test:ts"]).toContain("npm run test --workspaces");
    expect(scripts["test:rust"]).toContain("cargo test");
  });

  it("ship:check is typecheck + npm test", () => {
    expect(scripts["ship:check"]).toBe("npm run typecheck && npm test");
  });

  const ship = Object.entries(scripts).filter(([name]) => name.startsWith("ship:") && name !== "ship:check");

  it("there are ship scripts for the dev and production Worker and the app", () => {
    expect(ship.map(([n]) => n).sort()).toEqual(["ship:api:dev", "ship:api:prod", "ship:app"]);
  });

  it.each(ship)("%s runs ship:check before anything else", (_name, cmd) => {
    expect(cmd.startsWith("npm run ship:check && ")).toBe(true);
  });

  it("deploys apply migrations first and always name the environment", () => {
    for (const env of ["dev", "production"]) {
      const cmd = scripts[env === "dev" ? "ship:api:dev" : "ship:api:prod"]!;
      const migrate = cmd.indexOf(`migrations apply DB --remote --env ${env}`);
      const deploy = cmd.indexOf(`wrangler deploy --env ${env}`);
      expect(migrate).toBeGreaterThan(0);
      expect(deploy).toBeGreaterThan(migrate);
    }
  });

  it("docs/shipping.md routes every release through the ship scripts", () => {
    for (const [name] of ship) expect(shipping).toContain(`npm run ${name}`);
    expect(shipping).toContain("npm run ship:check");
  });
});
