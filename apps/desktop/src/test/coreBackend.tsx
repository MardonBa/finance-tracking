/**
 * The one test backend for window tests: runs the REAL core registry queries
 * and actions in-process against fixture data from `@ft/core/fixtures`, the
 * way the Worker does (only the slices a query/action `needs`, a JSON round
 * trip, undo through the inverse mutations). Windows therefore render real
 * core outputs, and actions really change the data the next query sees.
 *
 * Three ways to plug it in:
 *  - `installCoreBackend(fixture)`: replaces `fetch`, so the real API client
 *    (`/q/:name`, `/a/:name`, `/a/:name/preview`) talks to it.
 *  - `vi.mock("…/api/client.ts", async () => (await import("…/test/coreBackend.tsx")).clientMock)`
 *    with `resetCore(data?)` / `coreData()` / `calls` / `runCoreQuery` (the
 *    core-flows fixture by default).
 *  - `createCoreBackend(fixture)` for a backend object whose `runQuery` /
 *    `previewAction` / `runAction` / `undoAction` match the API client's, to
 *    wire into a hand-written client mock.
 */
import { vi } from "vitest";
import {
  ActionError,
  actionRegistry,
  applyMutations,
  inverseMutations,
  queryRegistry,
  type ActionContext,
  type CoreData,
  type Mutation,
  type RecurringItem,
  type Transaction,
} from "@ft/core";
import { basicFixture, flowsFixture } from "@ft/core/fixtures";

export interface Call {
  kind: "query" | "preview" | "action" | "undo";
  name: string;
  input: unknown;
}

export interface QueryResult<V = unknown> {
  value: V;
  figures: Record<string, { cents: number; contributions: { transactionId: string; cents: number }[]; label?: string }>;
}

export interface CoreBackend {
  data: CoreData;
  today: string;
  calls: Call[];
  /** Calls of one query/action name, in order. */
  callsTo(name: string): Call[];
  /** Inputs of every applied action with this name. */
  actions(name: string): unknown[];
  /** Params of every run of this query. */
  queries(name: string): unknown[];
  /** Synchronous query, for test expectations. */
  query<V = unknown>(name: string, params: unknown): QueryResult<V>;
  runQuery<V = unknown>(token: string, name: string, params: unknown): Promise<QueryResult<V>>;
  previewAction(token: string, name: string, input: unknown): Promise<{ preview: unknown }>;
  runAction(token: string, name: string, input: unknown): Promise<{ logId: string; preview: unknown }>;
  undoAction(token: string, logId: string): Promise<{ undone: string }>;
}

const roundTrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function slices(data: CoreData, needs: readonly (keyof CoreData)[]) {
  return Object.fromEntries(needs.map((k) => [k, data[k]])) as never;
}

export function createCoreBackend(fixture: { data: CoreData; today: string }, opts: { calls?: Call[] } = {}): CoreBackend {
  let n = 0;
  const undo = new Map<string, Mutation[]>();
  const ctx = (): ActionContext => ({ today: be.today, now: `${be.today}T12:00:00.000Z`, newId: () => `new_${++n}` });
  const action = (name: string) => {
    const a = actionRegistry.get(name);
    if (!a) throw new Error(`Unknown action ${name}`);
    return a;
  };
  const be: CoreBackend = {
    data: fixture.data,
    today: fixture.today,
    calls: opts.calls ?? [],
    callsTo: (name) => be.calls.filter((c) => c.name === name),
    actions: (name) => be.calls.filter((c) => c.kind === "action" && c.name === name).map((c) => c.input),
    queries: (name) => be.calls.filter((c) => c.kind === "query" && c.name === name).map((c) => c.input),
    query<V>(name: string, params: unknown) {
      const q = queryRegistry.get(name);
      if (!q) throw new Error(`Unknown query ${name}`);
      return roundTrip(q.run(slices(be.data, q.needs), q.params.parse(params ?? {}), be.today)) as QueryResult<V>;
    },
    async runQuery<V>(_t: string, name: string, params: unknown) {
      be.calls.push({ kind: "query", name, input: params });
      return be.query<V>(name, params);
    },
    async previewAction(_t, name, input) {
      be.calls.push({ kind: "preview", name, input });
      const a = action(name);
      return { preview: roundTrip(a.describe(slices(be.data, a.needs), a.input.parse(input), ctx())) };
    },
    async runAction(_t, name, input) {
      be.calls.push({ kind: "action", name, input });
      const a = action(name);
      const parsed = a.input.parse(input);
      const s = slices(be.data, a.needs);
      const c = ctx();
      const preview = a.describe(s, parsed, c);
      const muts = a.apply(s, parsed, c);
      const inv = a.inverse ? a.inverse(s, parsed, muts) : inverseMutations(s, muts);
      be.data = applyMutations(be.data, muts);
      const logId = `log_${++n}`;
      undo.set(logId, inv);
      return { logId, preview: roundTrip(preview) };
    },
    async undoAction(_t, logId) {
      be.calls.push({ kind: "undo", name: logId, input: null });
      be.data = applyMutations(be.data, undo.get(logId) ?? []);
      undo.delete(logId);
      return { undone: logId };
    },
  };
  return be;
}

// ------------------------------------------------------------ fetch stub

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Replaces `fetch` so the real API client talks to an in-process core backend. Undo with `vi.unstubAllGlobals()`. */
export function installCoreBackend(fixture: { data: CoreData; today: string }): CoreBackend {
  const be = createCoreBackend(fixture);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : JSON.parse(u.searchParams.get("params") ?? "{}");
      try {
        const q = path.match(/^\/q\/(.+)$/);
        if (q) {
          const name = decodeURIComponent(q[1]!);
          if (!queryRegistry.get(name)) return json({ error: `Unknown query ${name}` }, 404);
          return json(await be.runQuery("", name, body));
        }
        const a = path.match(/^\/a\/([^/]+)(\/preview)?$/);
        if (a) {
          const name = decodeURIComponent(a[1]!);
          if (!actionRegistry.get(name)) return json({ error: `Unknown action ${name}` }, 404);
          return json(a[2] ? await be.previewAction("", name, body) : await be.runAction("", name, body));
        }
        const u2 = path.match(/^\/actions\/([^/]+)\/undo$/);
        if (u2) return json(await be.undoAction("", decodeURIComponent(u2[1]!)));
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ message: e instanceof Error ? e.message : String(e) }, e instanceof ActionError ? 400 : 500);
      }
    }),
  );
  return be;
}

// ------------------------------------------------------- client module mock

/** "Today" of the default (core-flows) fixture. */
export const TODAY = flowsFixture().today;
/** Every call the default backend saw since the last `resetCore`. */
export const calls: Call[] = [];
let current = createCoreBackend(flowsFixture(), { calls });

/** Fresh default backend: the core-flows fixture, or `next` with the same "today". */
export function resetCore(next?: CoreData): CoreBackend {
  calls.length = 0;
  current = createCoreBackend({ data: next ?? flowsFixture().data, today: TODAY }, { calls });
  return current;
}

/** The default backend's data right now (after any actions). */
export function coreData(): CoreData {
  return current.data;
}

/** Runs a registry query on the default backend the way the API does. */
export function runCoreQuery<V = unknown>(name: string, params: unknown): QueryResult<V> {
  return current.query<V>(name, params);
}

/** Drop-in for `api/client.ts` backed by the default backend. */
export const clientMock = {
  API_URL: "http://test",
  DEV_APP_TOKEN: undefined,
  ApiError: class ApiError extends Error {
    status = 400;
  },
  setUnauthorizedHandler() {},
  async revokeCredential() {
    return { revoked: 0 };
  },
  runQuery: (t: string, name: string, params: unknown) => current.runQuery(t, name, params),
  previewAction: (t: string, name: string, input: unknown) => current.previewAction(t, name, input),
  runAction: (t: string, name: string, input: unknown) => current.runAction(t, name, input),
  undoAction: (t: string, logId: string) => current.undoAction(t, logId),
};

// ---------------------------------------------------------------- fixture helpers

export function recurringItem(over: Partial<RecurringItem> & { id: string }): RecurringItem {
  return {
    plaidStreamId: `stream_${over.id}`,
    source: "auto",
    accountId: "acc_checking",
    direction: "outflow",
    description: over.id,
    merchantName: null,
    category: null,
    frequency: "monthly",
    averageAmountCents: 1000,
    lastAmountCents: 1000,
    lastDate: null,
    predictedNextDate: null,
    isActive: true,
    plaidStatus: "MATURE",
    firstSeenOn: "2026-01-01",
    ...over,
  };
}

export function transaction(id: string, accountId: string, date: string, amountCents: number, over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    plaidTransactionId: null,
    accountId,
    amountCents,
    isoCurrencyCode: "USD",
    date,
    authorizedDate: null,
    pending: false,
    pendingTransactionId: null,
    rawDescription: id,
    merchantName: null,
    merchantEntityId: null,
    plaidCategoryPrimary: null,
    plaidCategoryDetailed: null,
    plaidCategoryConfidence: null,
    isManual: false,
    removed: false,
    removedAt: null,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    ...over,
  };
}

/**
 * The basic core fixture (today 2026-10-31, checking $3,523.10) plus
 * recurring items: rent, a paycheck on the 15th, a variable power bill
 * (estimated from two past bills) and a new streaming charge.
 */
export function recurringFixture(): { data: CoreData; today: string } {
  const { data, today } = basicFixture();
  data.transactions.push(
    transaction("tx_power_sep", "acc_checking", "2026-09-10", -9000, { merchantName: "City Power" }),
    transaction("tx_power_oct", "acc_checking", "2026-10-10", -12000, { merchantName: "City Power" }),
  );
  data.recurringItems = [
    recurringItem({ id: "r_rent", merchantName: "Rent", predictedNextDate: "2026-11-01", averageAmountCents: 300000, lastAmountCents: 300000 }),
    recurringItem({ id: "r_pay", direction: "inflow", merchantName: "Acme Payroll", frequency: "semi_monthly", predictedNextDate: "2026-11-15", averageAmountCents: 250000, lastAmountCents: 250000 }),
    recurringItem({ id: "r_power", merchantName: "City Power", predictedNextDate: "2026-11-10", averageAmountCents: 10500 }),
    recurringItem({ id: "r_stream", merchantName: "Streamly", predictedNextDate: "2026-11-12", averageAmountCents: 1599, lastAmountCents: 1599, firstSeenOn: "2026-10-20" }),
  ];
  data.recurringItemTransactions = [
    { recurringItemId: "r_pay", transactionId: "tx_paycheck" },
    { recurringItemId: "r_power", transactionId: "tx_power_sep" },
    { recurringItemId: "r_power", transactionId: "tx_power_oct" },
  ];
  return { data, today };
}
