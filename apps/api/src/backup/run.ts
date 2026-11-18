/**
 * Weekly encrypted backup to R2 (§2 "Nothing is lost"); see
 * docs/backup-restore.md. Exports BACKUP_TABLES, encrypts with
 * BACKUP_ENC_KEY, writes backups/YYYY-MM-DD.json.enc and keeps the newest
 * BACKUP_RETENTION files.
 */
import type { AppEnv } from "../env.ts";
import { BACKUP_TABLES, backupKey, backupSummary, encodeBackup, type BackupData, type SqlValue } from "./format.ts";

/** TODO(revisit): keep the last 12 weekly backups (~3 months); success-criteria §2 Open. */
export const BACKUP_RETENTION = 12;

export async function existingTables(d1: D1Database): Promise<Set<string>> {
  const res = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  return new Set(res.results.map((r) => r.name));
}

export async function exportTables(env: AppEnv, createdAt: string): Promise<BackupData> {
  const present = await existingTables(env.DB);
  const data: BackupData = { version: 1, createdAt, environment: env.ENVIRONMENT, tables: {} };
  for (const name of BACKUP_TABLES) {
    if (!present.has(name)) continue; // e.g. trajectory tables before their migration lands
    const [columns, ...rows] = await env.DB.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).raw<SqlValue[]>({ columnNames: true });
    data.tables[name] = { columns: (columns ?? []) as string[], rows };
  }
  return data;
}

export async function runBackup(env: AppEnv, date: string, nowIso: string) {
  const data = await exportTables(env, nowIso);
  const file = await encodeBackup(data, env.BACKUP_ENC_KEY);
  const key = backupKey(date);
  await env.BACKUPS.put(key, file, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { version: "1", createdAt: nowIso } });
  const deleted = await pruneBackups(env.BACKUPS, BACKUP_RETENTION);
  return { key, bytes: file.length, rows: backupSummary(data), deleted };
}

/** Delete all but the newest `keep` backups (keys sort by date). */
export async function pruneBackups(bucket: R2Bucket, keep: number): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "backups/", cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const old = keys.filter((k) => /^backups\/\d{4}-\d{2}-\d{2}\.json\.enc$/.test(k)).sort().slice(0, -keep || undefined);
  if (keep > 0 && old.length > 0) await bucket.delete(old);
  return keep > 0 ? old : [];
}
