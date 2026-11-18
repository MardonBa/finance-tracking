/**
 * Bridges @ft/core and D1: loads CoreData slices for queries/actions and
 * executes registry Mutations atomically (one D1 batch).
 */
import { and, eq, getTableColumns, inArray, type SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { PRIMARY_KEYS, type CoreData, type DataKey, type Mutation } from "@ft/core";
import { SECRET_COLUMNS, TABLES } from "./tables.ts";
import { sliceVersions } from "./schema.ts";

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

/**
 * Slice cache (saves D1 row reads, which the free plan caps per day).
 *
 * Every data table has triggers that give its `slice_versions` row a new random
 * token on any insert, update or delete (migration 0004), whoever writes: actions,
 * sync, webhooks, restores, tests. A request reads only those tokens (one row per
 * slice) and re-reads a table only when its token differs from the cached one.
 * Equal token means the same rows, so a cache can't serve stale data. Read the
 * token BEFORE the rows: a write in between only makes the cache newer than its
 * token, which costs one extra re-read later, never a stale answer.
 *
 * Cached rows are frozen (core functions must not mutate their input) and each
 * caller gets its own array, so sorting in place stays safe.
 */
const cache = new Map<DataKey, { token: string; rows: readonly object[] }>();
const inflight = new Map<string, Promise<readonly object[]>>();

/** How many full table reads this isolate has made, per slice (tests and diagnostics). */
export const sliceReads = new Map<DataKey, number>();

/** Tests only: forget everything cached in this isolate. */
export function clearSliceCacheForTests(): void {
  cache.clear();
  inflight.clear();
  sliceReads.clear();
}

async function readTable(db: Db, key: DataKey): Promise<readonly object[]> {
  sliceReads.set(key, (sliceReads.get(key) ?? 0) + 1);
  const rows = (await db.select(publicColumns(key) as never).from(table(key)).all()) as object[];
  for (const r of rows) Object.freeze(r);
  return Object.freeze(rows);
}

async function sliceTokens(db: Db, keys: readonly DataKey[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  try {
    const rows = await db.select().from(sliceVersions).where(inArray(sliceVersions.slice, keys as string[])).all();
    return new Map(rows.map((r) => [r.slice, r.token]));
  } catch {
    return new Map(); // no versions table (e.g. before migration 0004): read tables directly
  }
}

async function loadSlice(db: Db, key: DataKey, token: string | undefined): Promise<readonly object[]> {
  if (token === undefined) return readTable(db, key);
  const hit = cache.get(key);
  if (hit && hit.token === token) return hit.rows;
  const id = `${key}:${token}`;
  let pending = inflight.get(id);
  if (!pending) {
    pending = readTable(db, key)
      .then((rows) => {
        cache.set(key, { token, rows });
        return rows;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, pending);
  }
  return pending;
}

/** Load the requested slices. Unrequested slices are absent, so reading them fails loudly. */
export async function loadSlices<K extends DataKey>(db: Db, keys: readonly K[]): Promise<Pick<CoreData, K>> {
  const unique = [...new Set(keys)];
  const tokens = await sliceTokens(db, unique);
  const rows = await Promise.all(unique.map((k) => loadSlice(db, k, tokens.get(k))));
  return Object.fromEntries(unique.map((k, i) => [k, rows[i]!.slice()])) as unknown as Pick<CoreData, K>;
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
