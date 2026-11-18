/**
 * Restore an encrypted R2 backup into a FRESH D1 database (docs/backup-restore.md).
 *
 *   npm run restore -- <key> [--env dev|production] [--remote] [--from-file <path>] [--dry-run]
 *
 *   <key>          e.g. backups/2026-11-22.json.enc (or just 2026-11-22)
 *   --env          wrangler environment (default dev)
 *   --remote       restore into the deployed D1 (default: the local dev D1)
 *   --from-file    read the encrypted backup from a local file instead of R2
 *   --dry-run      decrypt and print row counts, change nothing
 *
 * The key comes from BACKUP_ENC_KEY in the environment, else (dev only) from
 * apps/api/.dev.vars. For production, export it in your shell first; it is
 * never written to disk by this script. Refuses to load into a database that
 * already has accounts or transactions. Prints counts only, never data.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupKey, backupSummary, decodeBackup, restoreSql } from "../src/backup/format.ts";

const API = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith("--") && !["--env", "--from-file"].includes(args[i - 1] ?? ""));

const envName = opt("--env") ?? "dev";
if (!["dev", "production"].includes(envName)) throw new Error("--env must be dev or production");
const target = flag("--remote") ? "--remote" : "--local";
const rawKey = positional[0];
if (!rawKey && !opt("--from-file")) {
  console.error("Usage: npm run restore -- <backups/YYYY-MM-DD.json.enc> [--env dev|production] [--remote] [--from-file path] [--dry-run]");
  process.exit(1);
}
const key = rawKey && /^\d{4}-\d{2}-\d{2}$/.test(rawKey) ? backupKey(rawKey) : rawKey;

function wrangler(cmdArgs: string[], capture = false): string {
  const res = spawnSync("npx", ["wrangler", ...cmdArgs], { cwd: API, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", env: { ...process.env, CI: "1" } });
  if (res.status !== 0) {
    console.error(`Failed: wrangler ${cmdArgs.join(" ")}`);
    process.exit(res.status ?? 1);
  }
  return res.stdout ?? "";
}

function bucketName(): string {
  const toml = readFileSync(join(API, "wrangler.toml"), "utf8");
  const section = toml.split(/^\[\[env\.(\w+)\.r2_buckets\]\]/m);
  for (let i = 1; i < section.length; i += 2) {
    if (section[i] === envName) {
      const m = /bucket_name\s*=\s*"([^"]+)"/.exec(section[i + 1] ?? "");
      if (m?.[1]) return m[1];
    }
  }
  throw new Error(`No R2 bucket for env ${envName} in wrangler.toml`);
}

function backupKeyFromEnv(): string {
  if (process.env.BACKUP_ENC_KEY) return process.env.BACKUP_ENC_KEY;
  const devVars = join(API, ".dev.vars");
  if (envName === "dev" && existsSync(devVars)) {
    const m = /^BACKUP_ENC_KEY=(.*)$/m.exec(readFileSync(devVars, "utf8"));
    if (m?.[1]) return m[1].trim();
  }
  throw new Error("Set BACKUP_ENC_KEY in the environment (for production, the key you set with wrangler secret put)");
}

const work = mkdtempSync(join(tmpdir(), "ft-restore-"));
try {
  let file = opt("--from-file");
  if (!file) {
    file = join(work, "backup.enc");
    wrangler(["r2", "object", "get", `${bucketName()}/${key}`, "--file", file, "--env", envName, target]);
  }
  const data = await decodeBackup(new Uint8Array(readFileSync(file)), backupKeyFromEnv());
  const counts = backupSummary(data);
  console.log(`Backup from ${data.createdAt} (${data.environment}): ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(", ")}`);
  if (flag("--dry-run")) process.exit(0);

  // A fresh database: apply migrations, then refuse if it already holds data.
  wrangler(["d1", "migrations", "apply", "DB", "--env", envName, target]);
  const check = JSON.parse(
    wrangler(["d1", "execute", "DB", "--env", envName, target, "--json", "--command", "SELECT (SELECT count(*) FROM accounts) + (SELECT count(*) FROM transactions) AS n"], true),
  ) as Array<{ results: Array<{ n: number }> }>;
  if ((check[0]?.results[0]?.n ?? 0) > 0) {
    console.error("Refusing to restore: the target database already has accounts or transactions. Restore into a fresh database.");
    process.exit(1);
  }
  const tables = JSON.parse(wrangler(["d1", "execute", "DB", "--env", envName, target, "--json", "--command", "SELECT name FROM sqlite_master WHERE type='table'"], true)) as Array<{
    results: Array<{ name: string }>;
  }>;
  const statements = restoreSql(data, new Set(tables[0]?.results.map((r) => r.name)));
  const sqlFile = join(work, "restore.sql");
  writeFileSync(sqlFile, `PRAGMA defer_foreign_keys = on;\n${statements.join("\n")}\n`, { mode: 0o600 });
  wrangler(["d1", "execute", "DB", "--env", envName, target, "--file", sqlFile]);
  console.log(`Restored ${statements.length} rows into ${envName} (${target.slice(2)}). Sign in with Google again: app credentials are not part of backups.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
