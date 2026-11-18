/**
 * Test backend for window tests: replaces `fetch` so the real API client
 * (`/q/:name`, `/a/:name`, `/a/:name/preview`) runs the real core registry
 * queries and actions in-process against fixture data from
 * `@ft/core/fixtures`. Windows therefore render real core outputs, and
 * actions really change the data the next query sees.
 */
import { vi } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { ActionError, actionRegistry, applyMutations, queryRegistry, type CoreData, type RecurringItem, type Transaction } from "@ft/core";
import { basicFixture } from "@ft/core/fixtures";
import { AppTokenContext } from "../shell/context.ts";

export interface Call {
  kind: "query" | "action" | "preview";
  name: string;
  body: unknown;
}

export interface CoreBackend {
  data: CoreData;
  today: string;
  calls: Call[];
  /** Calls of one query/action name, in order. */
  callsTo(name: string): Call[];
}

function slices(data: CoreData, needs: readonly (keyof CoreData)[]) {
  return Object.fromEntries(needs.map((k) => [k, data[k]]));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function installCoreBackend(fixture: { data: CoreData; today: string }): CoreBackend {
  const backend: CoreBackend = {
    data: fixture.data,
    today: fixture.today,
    calls: [],
    callsTo: (name) => backend.calls.filter((c) => c.name === name),
  };
  let ids = 0;
  const ctx = () => ({ today: backend.today, now: `${backend.today}T12:00:00.000Z`, newId: () => `new_${++ids}` });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      try {
        const q = path.match(/^\/q\/(.+)$/);
        if (q) {
          const name = decodeURIComponent(q[1]!);
          backend.calls.push({ kind: "query", name, body });
          const def = queryRegistry.get(name);
          if (!def) return json({ error: `Unknown query ${name}` }, 404);
          const result = def.run(slices(backend.data, def.needs) as never, def.params.parse(body), backend.today);
          return json(result);
        }
        const a = path.match(/^\/a\/([^/]+)(\/preview)?$/);
        if (a) {
          const name = decodeURIComponent(a[1]!);
          const def = actionRegistry.get(name);
          backend.calls.push({ kind: a[2] ? "preview" : "action", name, body });
          if (!def) return json({ error: `Unknown action ${name}` }, 404);
          const input = def.input.parse(body);
          const s = slices(backend.data, def.needs) as never;
          const preview = def.describe(s, input, ctx());
          if (a[2]) return json({ preview });
          backend.data = applyMutations(backend.data, def.apply(s, input, ctx()));
          return json({ logId: `log_${backend.calls.length}`, preview });
        }
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ message: e instanceof Error ? e.message : String(e) }, e instanceof ActionError ? 400 : 500);
      }
    }),
  );
  return backend;
}

export function renderWithToken(ui: ReactNode) {
  return render(<AppTokenContext.Provider value="test-token">{ui}</AppTokenContext.Provider>);
}

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
