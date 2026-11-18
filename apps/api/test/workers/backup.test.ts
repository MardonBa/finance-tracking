import { applyD1Migrations, createExecutionContext, createScheduledController, reset, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../src/index.ts";
import { BACKUP_TABLES, backupKey, decodeBackup, encodeBackup, restoreSql } from "../../src/backup/format.ts";
import { BACKUP_RETENTION, existingTables, pruneBackups, runBackup } from "../../src/backup/run.ts";
import { addCredential, count, loadBasicFixture } from "./helpers.ts";

/** Every row of every backed-up table, in a stable order. */
async function snapshot() {
  const present = await existingTables(env.DB);
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    if (!present.has(t)) continue;
    out[t] = (await env.DB.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()).results;
  }
  return out;
}

describe("encrypted backups (§2 Nothing is lost)", () => {
  it("backup → fresh database → restore gives identical rows", async () => {
    await loadBasicFixture();
    await addCredential();
    // Edits and history beyond the fixture: action log, a note with quotes and unicode.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO action_log (id, action_name, input_json, summary, mutations_json, inverse_json, source, applied_at) VALUES ('al1', 'x', '{}', 'Renamed \"it''s\" → café', '[]', '[]', 'user', '2026-11-01')",
      ),
    ]);
    const before = await snapshot();
    expect(Object.values(before).reduce((n, r) => n + r.length, 0)).toBeGreaterThan(30);

    const result = await runBackup(env, "2026-11-22", "2026-11-22T12:00:00.000Z");
    expect(result.key).toBe("backups/2026-11-22.json.enc");
    const obj = await env.BACKUPS.get(result.key);
    const file = new Uint8Array(await obj!.arrayBuffer());

    // Encrypted at rest: no plaintext from the database is visible.
    const asText = new TextDecoder("latin1").decode(file);
    expect(asText.startsWith("FTB1")).toBe(true);
    expect(asText).not.toContain("café");
    expect(asText).not.toContain("transactions");
    await expect(decodeBackup(file, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")).rejects.toThrow(); // the token key is not the backup key

    // Fresh database: wipe everything, re-apply migrations.
    await reset();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    expect(await count("transactions")).toBe(0);

    const data = await decodeBackup(file, env.BACKUP_ENC_KEY);
    const statements = restoreSql(data, await existingTables(env.DB));
    await env.DB.batch([env.DB.prepare("PRAGMA defer_foreign_keys = on"), ...statements.map((s) => env.DB.prepare(s))]);

    expect(await snapshot()).toEqual(before);
    // App credentials are deliberately not restored: sign in with Google again.
    expect(await count("app_credentials")).toBe(0);
  });

  it("restoreSql refuses unknown tables and escapes values", async () => {
    const data = { version: 1 as const, createdAt: "x", environment: "dev", tables: { evil: { columns: ["a"], rows: [["b"]] } } };
    expect(() => restoreSql(data)).toThrow(/unknown table/);
    const ok = restoreSql({ version: 1, createdAt: "x", environment: "dev", tables: { tags: { columns: ["id", "name", "created_at"], rows: [["t1", "a'); DROP TABLE tags;--", "2026"]] } } });
    expect(ok).toEqual([`INSERT INTO "tags" ("id", "name", "created_at") VALUES ('t1', 'a''); DROP TABLE tags;--', '2026');`]);
  });

  it("keeps only the newest backups", async () => {
    const file = await encodeBackup({ version: 1, createdAt: "x", environment: "dev", tables: {} }, env.BACKUP_ENC_KEY);
    for (let d = 1; d <= 15; d++) await env.BACKUPS.put(backupKey(`2026-01-${String(d).padStart(2, "0")}`), file);
    await env.BACKUPS.put("backups/notes.txt", "keep me");
    const deleted = await pruneBackups(env.BACKUPS, BACKUP_RETENTION);
    expect(deleted).toEqual(["backups/2026-01-01.json.enc", "backups/2026-01-02.json.enc", "backups/2026-01-03.json.enc"]);
    const left = (await env.BACKUPS.list({ prefix: "backups/" })).objects.map((o) => o.key);
    expect(left).toHaveLength(13);
    expect(left).toContain("backups/notes.txt");
  });

  it("the weekly cron writes a backup for the user's date", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.UTC(2026, 10, 22, 12), cron: "0 12 * * SUN" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await env.BACKUPS.head("backups/2026-11-22.json.enc")).not.toBeNull();
  });

  it("skips tables that do not exist yet (trajectory tables before their migration)", async () => {
    const tables = await existingTables(env.DB);
    const result = await runBackup(env, "2026-11-23", "2026-11-23T00:00:00.000Z");
    for (const t of ["trajectory_assumptions", "life_phases"]) {
      if (!tables.has(t)) expect(result.rows).not.toHaveProperty(t);
    }
    expect(result.rows).toHaveProperty("transactions");
  });
});
