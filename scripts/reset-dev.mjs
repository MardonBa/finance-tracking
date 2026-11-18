#!/usr/bin/env node
// Resets the LOCAL dev D1 (the one `npm run dev` uses) to a known state:
// drops every table, re-applies the migrations, loads the deterministic seed
// (apps/api/seed/dev-seed.ts) and registers DEV_APP_TOKEN as an app credential.
//
//   npm run reset:dev                       seed for today
//   npm run reset:dev -- --today 2026-11-18 same seed for a fixed day
//   npm run reset:dev -- --sandbox          also create Plaid Sandbox items from
//                                           apps/api/seed/custom-users/*.json
//
// Only ever touches --local state with --env dev; it cannot reach production.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readEnvFile } from "./lib/env-file.mjs";

const API = join(ROOT, "apps/api");
const STATE = join(API, ".wrangler");
const args = process.argv.slice(2);

function run(cmd, cmdArgs, { env = {}, capture = false } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: API,
    env: { ...process.env, ...env },
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error(`Failed: ${cmd} ${cmdArgs.join(" ")}`);
    process.exit(res.status ?? 1);
  }
  return res.stdout;
}

const d1 = (...a) => ["wrangler", "d1", ...a, "--local", "--env", "dev"];

run("node", [join(ROOT, "scripts/sync-dev-vars.mjs")]);
const secrets = { ...readEnvFile(join(API, ".dev.vars")), DEV_APP_TOKEN: readEnvFile().DEV_APP_TOKEN ?? "" };

// 1. Drop every table.
const listed = JSON.parse(
  run("npx", [...d1("execute", "DB"), "--json", "--command", "SELECT name FROM sqlite_master WHERE type='table'"], { capture: true }),
);
const tables = listed[0].results.map((r) => r.name).filter((n) => !n.startsWith("sqlite_") && !n.startsWith("_cf_"));
mkdirSync(STATE, { recursive: true });
if (tables.length > 0) {
  const dropFile = join(STATE, "reset-drop.sql");
  writeFileSync(dropFile, `PRAGMA defer_foreign_keys = on;\n${tables.map((t) => `DROP TABLE IF EXISTS "${t}";`).join("\n")}\n`);
  run("npx", [...d1("execute", "DB"), "--file", dropFile], { capture: true });
}
console.log(`Dropped ${tables.length} tables`);

// 2. Re-apply migrations.
run("npx", d1("migrations", "apply", "DB"), { env: { CI: "1" } });

// 3. Load the deterministic seed.
const seedFile = join(STATE, "seed.sql");
const todayIdx = args.indexOf("--today");
run("node", ["--experimental-strip-types", "--no-warnings", "seed/build-seed-sql.ts", seedFile, ...(todayIdx >= 0 ? ["--today", args[todayIdx + 1]] : [])], { env: secrets });
run("npx", [...d1("execute", "DB"), "--file", seedFile], { capture: true });
console.log("Seed loaded");

// 4. Optionally create Plaid Sandbox items.
if (args.includes("--sandbox")) {
  const sandboxFile = join(STATE, "sandbox-items.sql");
  run("node", ["--experimental-strip-types", "--no-warnings", "seed/sandbox.ts", "--sql", sandboxFile], { env: secrets });
  run("npx", [...d1("execute", "DB"), "--file", sandboxFile], { capture: true });
}

console.log("Local dev database reset. The desktop app authenticates with DEV_APP_TOKEN (apps/desktop/.env.development.local).");
