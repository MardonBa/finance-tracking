/**
 * Turns rows into literal SQL INSERT statements using the real Drizzle
 * schema (so column names can't drift), for `wrangler d1 execute --file`.
 */
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

const db = drizzle(async () => ({ rows: [] }));

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Cannot write ${v} to SQL`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replaceAll("'", "''")}'`;
}

export function insertSql(table: SQLiteTable, rows: readonly object[]): string[] {
  return rows.map((row) => {
    const { sql, params } = db.insert(table).values(row as never).toSQL();
    let i = 0;
    return `${sql.replace(/\?/g, () => literal(params[i++]))};`;
  });
}
