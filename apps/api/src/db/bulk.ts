/**
 * Bulk writes for sync. A first import can carry thousands of transactions;
 * one D1 statement per row would hit the per-invocation query limits of the
 * free plan. Instead each statement carries a chunk of rows as ONE JSON
 * parameter and expands it with json_each():
 *
 *   INSERT INTO t (a, b) SELECT json_extract(value,'$.a'), json_extract(value,'$.b')
 *   FROM json_each(?1) WHERE true ON CONFLICT (a) DO UPDATE SET b = excluded.b
 *
 * Rows use the Drizzle property names (camelCase); columns come from the
 * Drizzle table, so this stays in step with schema.ts. Booleans become 0/1
 * (json_extract of JSON true is 1).
 */
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/** Keep each JSON parameter well under D1's 2 MB value limit. */
const MAX_CHUNK_BYTES = 700_000;
const MAX_CHUNK_ROWS = 1000;

export function chunkJson<T>(rows: readonly T[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  for (const row of rows) {
    const s = JSON.stringify(row);
    if (current.length > 0 && (bytes + s.length + 1 > MAX_CHUNK_BYTES || current.length >= MAX_CHUNK_ROWS)) {
      out.push(`[${current.join(",")}]`);
      current = [];
      bytes = 2;
    }
    current.push(s);
    bytes += s.length + 1;
  }
  if (current.length > 0) out.push(`[${current.join(",")}]`);
  return out;
}

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

export interface BulkUpsertOptions<Row> {
  /** Properties forming the conflict target (a primary key or unique index). */
  conflict: ReadonlyArray<keyof Row & string>;
  /** Properties overwritten on conflict. Empty = keep the existing row (insert-or-ignore). */
  update: ReadonlyArray<keyof Row & string>;
}

/** Prepared statements that upsert `rows` into `table`, a chunk of rows per statement. */
export function bulkUpsert<Row extends Record<string, unknown>>(
  d1: D1Database,
  table: SQLiteTable,
  rows: readonly Row[],
  opts: BulkUpsertOptions<Row>,
): D1PreparedStatement[] {
  if (rows.length === 0) return [];
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const props = Object.keys(rows[0]!);
  for (const p of props) if (!cols[p]) throw new Error(`${getTableName(table)} has no column for property "${p}"`);
  const colName = (p: string) => q(cols[p]!.name);
  const select = props.map((p) => `json_extract(value, '$.${p}')`).join(", ");
  const conflict = `ON CONFLICT (${opts.conflict.map(colName).join(", ")})`;
  const action = opts.update.length === 0 ? "DO NOTHING" : `DO UPDATE SET ${opts.update.map((p) => `${colName(p)} = excluded.${colName(p)}`).join(", ")}`;
  const sql = `INSERT INTO ${q(getTableName(table))} (${props.map(colName).join(", ")}) SELECT ${select} FROM json_each(?1) WHERE true ${conflict} ${action}`;
  return chunkJson(rows).map((json) => d1.prepare(sql).bind(json));
}

/** Rows of `SELECT <cols> FROM table WHERE <column> IN (values)`, chunked through json_each. */
export async function selectWhereIn<T>(d1: D1Database, selectSql: string, column: string, values: readonly string[]): Promise<T[]> {
  const out: T[] = [];
  for (const json of chunkJson([...new Set(values)])) {
    const res = await d1.prepare(`${selectSql} WHERE ${column} IN (SELECT value FROM json_each(?1))`).bind(json).all<T>();
    out.push(...res.results);
  }
  return out;
}
