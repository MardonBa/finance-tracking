/**
 * Bridges @ft/core and D1: loads CoreData slices for queries/actions and
 * executes registry Mutations atomically (one D1 batch).
 */
import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { PRIMARY_KEYS, type CoreData, type DataKey, type Mutation } from "@ft/core";
import { SECRET_COLUMNS, TABLES } from "./tables.ts";

export type Db = DrizzleD1Database<Record<string, never>>;

export function getDb(d1: D1Database): Db {
  return drizzle(d1);
}

// Tables are a union of many concrete table types; treat them generically here.
type AnyTable = any;

function table(key: DataKey): AnyTable {
  const t = (TABLES as Record<string, AnyTable>)[key];
  if (!t) throw new Error(`Unknown data slice "${key}"`);
  return t;
}

/** Columns of a slice that may leave the backend (secrets removed). */
function publicColumns(key: DataKey): Record<string, unknown> {
  const cols = getTableColumns(table(key)) as Record<string, unknown>;
  const secret = new Set(SECRET_COLUMNS[key] ?? []);
  return Object.fromEntries(Object.entries(cols).filter(([name]) => !secret.has(name)));
}

/** Load the requested slices. Unrequested slices are absent, so reading them fails loudly. */
export async function loadSlices<K extends DataKey>(db: Db, keys: readonly K[]): Promise<Pick<CoreData, K>> {
  const unique = [...new Set(keys)];
  const rows = await Promise.all(unique.map((k) => db.select(publicColumns(k) as never).from(table(k)).all()));
  return Object.fromEntries(unique.map((k, i) => [k, rows[i]])) as unknown as Pick<CoreData, K>;
}

function keyCondition(key: DataKey, values: Record<string, unknown>): SQL {
  const cols = getTableColumns(table(key)) as Record<string, AnyTable>;
  const pk = PRIMARY_KEYS[key] as readonly string[];
  const conds = pk.map((name) => {
    if (values[name] === undefined) throw new Error(`Mutation on ${key} is missing primary key "${name}"`);
    return eq(cols[name], values[name]);
  });
  return and(...conds) as SQL;
}

/** Drizzle statements for a list of mutations (to run inside one batch). */
export function mutationStatements(db: Db, mutations: readonly Mutation[]): BatchItem<"sqlite">[] {
  return mutations.map((m) => {
    if (!(m.table in TABLES)) throw new Error(`Unknown table in mutation: ${String(m.table)}`);
    const secret = SECRET_COLUMNS[m.table] ?? [];
    if (m.op === "upsert") {
      const row = m.row as unknown as Record<string, unknown>;
      for (const s of secret) if (s in row) throw new Error(`Actions may not write ${m.table}.${s}`);
      const cols = getTableColumns(table(m.table)) as Record<string, AnyTable>;
      const target = (PRIMARY_KEYS[m.table] as readonly string[]).map((k) => cols[k]);
      return db.insert(table(m.table)).values(row).onConflictDoUpdate({ target, set: row }) as BatchItem<"sqlite">;
    }
    return db.delete(table(m.table)).where(keyCondition(m.table, m.key as Record<string, unknown>)) as BatchItem<"sqlite">;
  });
}
