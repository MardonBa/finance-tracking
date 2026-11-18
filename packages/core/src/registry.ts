/**
 * The query and action registries: the one way data is read (charts, API,
 * AI read tools) and changed (UI edits, API, AI write proposals).
 *
 * - A QUERY is pure: run(data, params, today) → { value, figures }.
 *   `figures` is the provenance: for every number the UI can click, the exact
 *   transactions (and the cents each contributed) that make it up, so
 *   drill-down lists always total the clicked number.
 * - An ACTION is pure too: it never touches the database. `apply` returns a
 *   list of row-level Mutations; the API runs them in one D1 batch, stores the
 *   inverse mutations in the action log, and can undo by running the inverse.
 */
import { z } from "zod";
import type { Cents } from "./money.ts";
import type { IsoDate } from "./dates.ts";
import type { CoreData, DataKey, Id, IsoDateTime, TransactionId } from "./types.ts";

// ---------------------------------------------------------------- queries

/** One cent-exact contribution to a figure. Splits name the split part. */
export interface Contribution {
  /** A Transaction id, or an InvestmentTransaction id when `source` says so. */
  transactionId: TransactionId;
  splitId?: Id;
  cents: Cents;
  /**
   * Where `transactionId` points. Absent = `transactions`. Dividends and
   * interest paid inside a brokerage come from `investmentTransactions` (§6, §17).
   */
  source?: "investment_transaction";
}

/**
 * A clickable number and where it came from. Invariant (tested generically):
 * cents === sum(contributions[].cents).
 */
export interface Figure {
  cents: Cents;
  contributions: Contribution[];
  /** Human-readable drill-down filter, e.g. "Dining · October · excluding transfers". */
  label?: string;
}

export interface QueryResult<V> {
  value: V;
  /** Keyed by a stable figure path such as "total" or "byCategory.FOOD_AND_DRINK". */
  figures: Record<string, Figure>;
}

export interface QueryDef<P extends z.ZodType = z.ZodType, K extends DataKey = DataKey, V = unknown> {
  /** "<module>.<camelName>", e.g. "spending.byCategory". */
  name: string;
  /** One sentence; reused as the AI tool description. */
  description: string;
  params: P;
  /** Data slices the query reads. The API loads only these. */
  needs: readonly K[];
  /**
   * At least one params example. Generic tests run every query with each
   * example against the hand-built fixture (@ft/core/fixtures) and check the
   * figure invariant, so every query is covered automatically.
   */
  examples: readonly [z.infer<P>, ...z.infer<P>[]];
  run(data: Pick<CoreData, K>, params: z.infer<P>, today: IsoDate): QueryResult<V>;
}

export function defineQuery<P extends z.ZodType, K extends DataKey, V>(def: QueryDef<P, K, V>): QueryDef<P, K, V> {
  return def;
}

export type AnyQuery = QueryDef<any, any, any>;

// ---------------------------------------------------------------- actions

type Row<K extends DataKey> = CoreData[K][number];

/**
 * A row-level change, expressed against CoreData slice names. The API maps
 * each slice to its D1 table (see apps/api/src/db/tables.ts).
 */
export type Mutation = {
  [K in DataKey]:
    | { op: "upsert"; table: K; row: Row<K> }
    | { op: "delete"; table: K; key: Partial<Row<K>> };
}[DataKey];

/**
 * Primary key columns of every slice, used to match rows for upsert, delete
 * and inverse. Must equal the primary keys in the D1 schema (tested in the API).
 */
export const PRIMARY_KEYS = {
  items: ["id"],
  accounts: ["id"],
  transactions: ["id"],
  overrides: ["transactionId"],
  tags: ["id"],
  transactionTags: ["transactionId", "tagId"],
  splits: ["id"],
  transferLinks: ["id"],
  refundLinks: ["id"],
  merchants: ["id"],
  merchantAliases: ["id"],
  rules: ["id"],
  necessaryLabels: ["id"],
  cuttingBack: ["id"],
  budgets: ["id"],
  budgetAmounts: ["budgetId", "effectiveFrom"],
  budgetParts: ["id"],
  budgetPartTargets: ["partId", "targetKind", "targetValue"],
  trips: ["id"],
  goals: ["id"],
  goalMilestonesSeen: ["goalId", "milestoneCents"],
  recurringItems: ["id"],
  recurringOverrides: ["recurringItemId"],
  recurringItemTransactions: ["recurringItemId", "transactionId"],
  liabilities: ["accountId"],
  securities: ["id"],
  holdings: ["accountId", "securityId", "asOfDate"],
  investmentTransactions: ["id"],
  balanceSnapshots: ["accountId", "date"],
} as const satisfies { [K in DataKey]: readonly (keyof Row<K> & string)[] };

export interface ActionContext {
  today: IsoDate;
  /** Current instant, passed in (core never reads the clock). */
  now: IsoDateTime;
  /** Deterministic id source, passed in (core never calls Math.random). */
  newId: () => Id;
}

export interface Change {
  label: string;
  before: string | null;
  after: string | null;
}

/** What the user (or the AI approval card) sees before approving. */
export interface ActionPreview {
  summary: string;
  changes: Change[];
}

export interface ActionDef<I extends z.ZodType = z.ZodType, K extends DataKey = DataKey> {
  /** "<module>.<camelName>", e.g. "transactions.setNote". */
  name: string;
  /** One sentence; reused as the AI tool description. */
  description: string;
  input: I;
  /** Data slices `describe`, `apply` and `inverse` read. */
  needs: readonly K[];
  /**
   * Set when the AI must never get this action as a tool, with the reason
   * (bank connections, sign-in/security, anything that could move money).
   * The parity test treats every action without it as an AI tool.
   */
  aiExcluded?: string;
  /**
   * Example inputs against the hand-built fixture (@ft/core/fixtures). Generic
   * tests check that apply then inverse restores the data exactly.
   */
  examples?: readonly z.infer<I>[];
  /** Before → after, computed from current data without changing anything. */
  describe(data: Pick<CoreData, K>, input: z.infer<I>, ctx: ActionContext): ActionPreview;
  /** The row changes that perform the action. Throw ActionError for invalid requests. */
  apply(data: Pick<CoreData, K>, input: z.infer<I>, ctx: ActionContext): Mutation[];
  /**
   * The row changes that undo `apply`, computed from the data BEFORE apply.
   * Optional: the default `inverseMutations` restores every touched row.
   */
  inverse?(data: Pick<CoreData, K>, input: z.infer<I>, applied: Mutation[]): Mutation[];
}

export function defineAction<I extends z.ZodType, K extends DataKey>(def: ActionDef<I, K>): ActionDef<I, K> {
  return def;
}

export type AnyAction = ActionDef<any, any>;

/** A user-facing refusal (bad id, invariant would break). The API returns 400 with `message`. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

function keyOf(table: DataKey, row: Record<string, unknown>): string {
  return JSON.stringify(PRIMARY_KEYS[table].map((k) => row[k] ?? null));
}

export function findRow<K extends DataKey>(
  data: Partial<CoreData>,
  table: K,
  key: Partial<Row<K>>,
): Row<K> | undefined {
  const rows = data[table] as Row<K>[] | undefined;
  if (!rows) throw new Error(`findRow: slice "${table}" was not loaded (add it to needs)`);
  const wanted = keyOf(table, key as Record<string, unknown>);
  return rows.find((r) => keyOf(table, r as unknown as Record<string, unknown>) === wanted);
}

/**
 * Generic inverse: for each mutation (in reverse order), restore the row as it
 * was in `before` — re-upsert it if it existed, delete it if it was new.
 */
export function inverseMutations(before: Partial<CoreData>, applied: readonly Mutation[]): Mutation[] {
  const out: Mutation[] = [];
  const seen = new Set<string>();
  for (const m of [...applied].reverse()) {
    const key = m.op === "upsert" ? m.row : m.key;
    const id = `${m.table}:${keyOf(m.table, key as Record<string, unknown>)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const old = findRow(before, m.table, key as never);
    if (old) out.push({ op: "upsert", table: m.table, row: old } as Mutation);
    else if (m.op === "upsert") {
      const pk = Object.fromEntries(PRIMARY_KEYS[m.table].map((k) => [k, (m.row as unknown as Record<string, unknown>)[k]]));
      out.push({ op: "delete", table: m.table, key: pk } as Mutation);
    }
  }
  return out;
}

/** Apply mutations to in-memory data (tests, optimistic UI). Returns a new object. */
export function applyMutations<D extends Partial<CoreData>>(data: D, mutations: readonly Mutation[]): D {
  const next: Record<string, unknown[]> = { ...(data as Record<string, unknown[]>) };
  for (const m of mutations) {
    const rows = (next[m.table] ?? []) as Record<string, unknown>[];
    const key = keyOf(m.table, (m.op === "upsert" ? m.row : m.key) as Record<string, unknown>);
    const rest = rows.filter((r) => keyOf(m.table, r) !== key);
    next[m.table] = m.op === "upsert" ? [...rest, m.row] : rest;
  }
  return next as D;
}

// ---------------------------------------------------------------- registry

export interface Registry<T extends { name: string }> {
  all: readonly T[];
  get(name: string): T | undefined;
  names(): string[];
}

/**
 * Build a registry from per-module lists. Each module's definitions must be
 * named "<module>.<something>"; duplicate names throw.
 */
export function buildRegistry<T extends { name: string }>(modules: Record<string, readonly T[]>): Registry<T> {
  const map = new Map<string, T>();
  for (const [module, defs] of Object.entries(modules)) {
    for (const def of defs) {
      if (!def.name.startsWith(`${module}.`)) {
        throw new Error(`Registry: "${def.name}" is in module "${module}" but is not named "${module}.<name>"`);
      }
      if (map.has(def.name)) throw new Error(`Registry: duplicate name "${def.name}"`);
      map.set(def.name, def);
    }
  }
  const all = [...map.values()];
  return {
    all,
    get: (name) => map.get(name),
    names: () => [...map.keys()].sort(),
  };
}
