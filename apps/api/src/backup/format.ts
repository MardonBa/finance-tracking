/**
 * Backup file format (§2 "Nothing is lost"), shared by the Worker (weekly
 * export) and the Node restore script. Pure WebCrypto + CompressionStream, so
 * it runs the same in both.
 *
 *   file  = "FTB1" | iv (12 bytes) | AES-GCM-256( gzip( JSON ) )   key: BACKUP_ENC_KEY
 *   JSON  = { version: 1, createdAt, environment, tables: { <sql table>: { columns, rows } } }
 *
 * Restore turns the JSON into plain INSERT statements (restoreSql), loaded
 * into a freshly migrated database in BACKUP_TABLES order (parents first).
 */

/**
 * Tables exported, in insert order (foreign-key parents first).
 *
 * The non-refetchable data (my edits: overrides, notes, tags, splits,
 * transfer/refund links, merchant groupings, rules, labels, cutting back;
 * budgets; goals; recurring edits; snapshots; manual accounts and their
 * transactions; the action log; trajectory assumptions) refers by foreign key
 * to rows that came from Plaid (items, accounts, transactions, securities,
 * recurring streams). Those anchor rows are exported too, so a restore into a
 * fresh database is complete and consistent, and history older than Plaid's
 * 24 months survives. Plaid access tokens stay encrypted with TOKEN_ENC_KEY
 * inside the (separately encrypted) backup.
 *
 * Not exported: app_credentials (sign in with Google again after a restore),
 * sync_runs, link_sessions and ai_rate_counters (transient).
 */
export const BACKUP_TABLES = [
  // anchors from Plaid (or manual accounts/transactions)
  "plaid_items",
  "accounts",
  "transactions",
  "securities",
  // my edits on transactions
  "transaction_overrides",
  "tags",
  "transaction_tags",
  "splits",
  "transfer_links",
  "refund_links",
  // merchants, rules, labels
  "merchants",
  "merchant_aliases",
  "rules",
  "necessary_labels",
  "cutting_back",
  // budgets and trips
  "budgets",
  "budget_amounts",
  "budget_parts",
  "budget_part_targets",
  "trips",
  // goals
  "goals",
  "goal_milestones_seen",
  // recurring
  "recurring_items",
  "recurring_overrides",
  "recurring_item_transactions",
  // liabilities and investments
  "liabilities",
  "holdings",
  "investment_transactions",
  // history and audit
  "balance_snapshots",
  "action_log",
  // trajectory (added by core-balances; skipped while the table does not exist)
  "trajectory_assumptions",
  "life_phases",
] as const;

export type SqlValue = string | number | null;

export interface BackupTable {
  columns: string[];
  rows: SqlValue[][];
}

export interface BackupData {
  version: 1;
  createdAt: string;
  environment: string;
  tables: Record<string, BackupTable>;
}

const MAGIC = new TextEncoder().encode("FTB1");

function b64decode(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.length !== 32) throw new Error("BACKUP_ENC_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeBackup(data: BackupData, base64Key: string): Promise<Uint8Array<ArrayBuffer>> {
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream("gzip"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(base64Key), gz));
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + iv.length);
  return out;
}

export async function decodeBackup(file: Uint8Array<ArrayBuffer>, base64Key: string): Promise<BackupData> {
  if (file.length < 4 + 12 + 16 || !MAGIC.every((b, i) => file[i] === b)) throw new Error("Not a Finance Tracker backup (bad header)");
  const iv = file.slice(4, 16);
  const gz = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importKey(base64Key), file.slice(16)));
  const data = JSON.parse(new TextDecoder().decode(await pipe(gz, new DecompressionStream("gzip")))) as BackupData;
  if (data.version !== 1) throw new Error(`Unsupported backup version ${String(data.version)}`);
  return data;
}

/** R2 key for a backup taken on `date` (YYYY-MM-DD). */
export const backupKey = (date: string) => `backups/${date}.json.enc`;

function sqlLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Non-finite number in backup");
    return String(v);
  }
  return `'${String(v).replaceAll("'", "''")}'`;
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected identifier in backup: ${name}`);
  return `"${name}"`;
};

/**
 * INSERT statements that load a backup, one row per statement (D1 statements
 * are limited to 100 KB), parents first. Only tables in BACKUP_TABLES are
 * accepted; tables absent from `existingTables` (when given) are skipped.
 */
export function restoreSql(data: BackupData, existingTables?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const known = new Set<string>(BACKUP_TABLES);
  for (const name of Object.keys(data.tables)) if (!known.has(name)) throw new Error(`Backup contains an unknown table: ${name}`);
  for (const name of BACKUP_TABLES) {
    const t = data.tables[name];
    if (!t || t.rows.length === 0) continue;
    if (existingTables && !existingTables.has(name)) throw new Error(`Backup has rows for ${name} but the database has no such table (apply migrations first)`);
    const cols = t.columns.map(ident).join(", ");
    for (const row of t.rows) out.push(`INSERT INTO ${ident(name)} (${cols}) VALUES (${row.map(sqlLiteral).join(", ")});`);
  }
  return out;
}

/** Row counts per table, for logs and the restore script's summary. */
export function backupSummary(data: BackupData): Record<string, number> {
  return Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.rows.length]));
}
