/**
 * An in-memory fake of the Plaid API, plugged in through deps.plaidFetch.
 * Responses follow Plaid's documented shapes (the client validates them with
 * the same zod schemas as in production). Every request is recorded so tests
 * can check exactly what was asked (e.g. only read-only products).
 */
type Json = Record<string, unknown>;

export interface FakeAccount {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  current: number | null;
}

export interface FakeTx {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  pending?: boolean;
  pending_transaction_id?: string | null;
  name?: string;
  merchant_name?: string | null;
}

export interface SyncPage {
  added?: FakeTx[];
  modified?: FakeTx[];
  removed?: string[];
}

export interface FakeItem {
  itemId: string;
  accessToken: string;
  institutionId: string;
  institutionName: string;
  products: string[];
  accounts: FakeAccount[];
  /** Pages served in order; the cursor is the index of the next page. */
  pages: SyncPage[];
  error: string | null;
  consentExpiration: string | null;
  lastSuccessfulUpdate: string | null;
  holdings?: Array<{ account_id: string; security_id: string; quantity: number; value: number }>;
  securities?: Array<{ security_id: string; name: string; ticker_symbol: string | null; type: string }>;
  investmentTransactions?: Array<{ id: string; account_id: string; security_id: string | null; date: string; amount: number; type: string; subtype: string; quantity: number; name: string }>;
  credit?: Array<{ account_id: string; last_statement_balance: number; next_payment_due_date: string; minimum_payment_amount: number }>;
  streams?: Array<{ stream_id: string; account_id: string; description: string; direction: "inflow" | "outflow"; amount: number; transaction_ids: string[] }>;
}

export interface FakeLinkSession {
  finished?: boolean;
  publicToken?: string | null;
  exitError?: string | null;
  exited?: boolean;
}

export interface Failure {
  status?: number;
  error_type?: string;
  error_code: string;
  /** How many calls fail (default 1). */
  times?: number;
}

export class FakePlaid {
  items = new Map<string, FakeItem>(); // by access token
  linkTokens = new Map<string, FakeLinkSession[]>();
  publicTokens = new Map<string, string>(); // public token → access token
  calls: Array<{ endpoint: string; body: Json }> = [];
  failures = new Map<string, Failure>();
  private n = 0;

  addItem(partial: Partial<FakeItem> & { accounts: FakeAccount[] }): FakeItem {
    this.n++;
    const item: FakeItem = {
      itemId: `plaid-item-${this.n}`,
      accessToken: `access-sandbox-${this.n}`,
      institutionId: `ins_${this.n}`,
      institutionName: `Bank ${this.n}`,
      products: ["transactions"],
      pages: [],
      error: null,
      consentExpiration: null,
      lastSuccessfulUpdate: null,
      ...partial,
    };
    this.items.set(item.accessToken, item);
    return item;
  }

  /** A public token that exchanges into `item`'s access token. */
  publicTokenFor(item: FakeItem): string {
    const pt = `public-sandbox-${item.itemId}`;
    this.publicTokens.set(pt, item.accessToken);
    return pt;
  }

  fail(endpoint: string, failure: Failure) {
    this.failures.set(endpoint, failure);
  }

  callsTo(endpoint: string) {
    return this.calls.filter((c) => c.endpoint === endpoint);
  }

  /** Plug into deps.plaidFetch. */
  fetch: typeof fetch = async (input, init) => {
    const endpoint = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as Json;
    this.calls.push({ endpoint, body });
    const failure = this.failures.get(endpoint);
    if (failure) {
      const times = (failure.times ?? 1) - 1;
      if (times <= 0) this.failures.delete(endpoint);
      else this.failures.set(endpoint, { ...failure, times });
      return json(
        { error_type: failure.error_type ?? "ITEM_ERROR", error_code: failure.error_code, error_message: "fake failure", request_id: "req" },
        failure.status ?? 400,
      );
    }
    const handler = this.handlers[endpoint];
    if (!handler) return json({ error_type: "INVALID_REQUEST", error_code: "UNKNOWN_ENDPOINT", error_message: endpoint, request_id: "req" }, 400);
    try {
      return json({ ...handler(body), request_id: "req" });
    } catch (e) {
      if (e instanceof FakeError) return json({ error_type: e.type, error_code: e.code, error_message: e.code, request_id: "req" }, 400);
      throw e;
    }
  };

  private item(body: Json): FakeItem {
    const item = this.items.get(String(body.access_token));
    if (!item) throw new FakeError("INVALID_INPUT", "INVALID_ACCESS_TOKEN");
    return item;
  }

  private accountsOf(item: FakeItem) {
    return item.accounts.map((a) => ({
      account_id: a.account_id,
      balances: { current: a.current, available: null, iso_currency_code: "USD", last_updated_datetime: null },
      mask: a.mask,
      name: a.name,
      official_name: `${a.name} OFFICIAL`,
      type: a.type,
      subtype: a.subtype,
      owners: [{ names: ["Should Not Be Stored"], addresses: [], emails: [], phone_numbers: [] }],
    }));
  }

  private txJson(t: FakeTx) {
    return {
      transaction_id: t.transaction_id,
      account_id: t.account_id,
      amount: t.amount,
      iso_currency_code: "USD",
      date: t.date,
      authorized_date: t.date,
      pending: t.pending ?? false,
      pending_transaction_id: t.pending_transaction_id ?? null,
      name: t.name ?? "SOME MERCHANT",
      original_description: t.name ?? "SOME MERCHANT 1234",
      merchant_name: t.merchant_name ?? null,
      merchant_entity_id: null,
      personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER", confidence_level: "HIGH" },
      location: { address: "1 Secret St", city: "Nowhere", lat: 1, lon: 2 },
      payment_meta: { payee: "Someone" },
    };
  }

  private handlers: Record<string, (body: Json) => Json> = {
    "/link/token/create": () => {
      const token = `link-sandbox-${this.linkTokens.size + 1}`;
      this.linkTokens.set(token, []);
      return { link_token: token, expiration: "2099-01-01T00:00:00Z", hosted_link_url: `https://secure.plaid.com/hl/${token}` };
    },
    "/link/token/get": (body) => {
      const sessions = this.linkTokens.get(String(body.link_token));
      if (!sessions) throw new FakeError("INVALID_INPUT", "INVALID_LINK_TOKEN");
      return {
        link_token: body.link_token,
        link_sessions: sessions.map((s, i) => ({
          link_session_id: `ls-${i}`,
          finished_at: s.finished ? "2026-11-18T10:00:00Z" : null,
          exit: s.exited || s.exitError ? { error: s.exitError ? { error_code: s.exitError } : null, metadata: null } : null,
          results: s.publicToken ? { item_add_results: [{ public_token: s.publicToken, institution: null, accounts: [] }] } : null,
        })),
      };
    },
    "/item/public_token/exchange": (body) => {
      const access = this.publicTokens.get(String(body.public_token));
      if (!access) throw new FakeError("INVALID_INPUT", "INVALID_PUBLIC_TOKEN");
      return { access_token: access, item_id: this.items.get(access)!.itemId };
    },
    "/item/get": (body) => {
      const item = this.item(body);
      return {
        item: {
          item_id: item.itemId,
          institution_id: item.institutionId,
          institution_name: item.institutionName,
          error: item.error ? { error_code: item.error, error_type: "ITEM_ERROR" } : null,
          consent_expiration_time: item.consentExpiration,
          products: item.products,
          webhook: null,
        },
        status: { transactions: { last_successful_update: item.lastSuccessfulUpdate } },
      };
    },
    "/accounts/get": (body) => {
      const item = this.item(body);
      return { accounts: this.accountsOf(item), item: { item_id: item.itemId } };
    },
    "/accounts/balance/get": (body) => {
      const item = this.item(body);
      return { accounts: this.accountsOf(item), item: { item_id: item.itemId } };
    },
    "/institutions/get_by_id": (body) => ({ institution: { institution_id: body.institution_id, name: "Looked Up Bank" } }),
    "/transactions/sync": (body) => {
      const item = this.item(body);
      if (item.error) throw new FakeError("ITEM_ERROR", item.error);
      const index = body.cursor ? Number(String(body.cursor).slice(1)) : 0;
      const page = item.pages[index];
      const next = page ? index + 1 : index;
      return {
        accounts: this.accountsOf(item),
        added: (page?.added ?? []).map((t) => this.txJson(t)),
        modified: (page?.modified ?? []).map((t) => this.txJson(t)),
        removed: (page?.removed ?? []).map((id) => ({ transaction_id: id, account_id: null })),
        next_cursor: `c${next}`,
        has_more: next < item.pages.length,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      };
    },
    "/transactions/refresh": (body) => (this.item(body), {}),
    "/investments/refresh": (body) => (this.item(body), {}),
    "/transactions/recurring/get": (body) => {
      const item = this.item(body);
      const stream = (s: NonNullable<FakeItem["streams"]>[number]) => ({
        stream_id: s.stream_id,
        account_id: s.account_id,
        description: s.description,
        merchant_name: null,
        frequency: "MONTHLY",
        average_amount: { amount: s.amount, iso_currency_code: "USD" },
        last_amount: { amount: s.amount, iso_currency_code: "USD" },
        first_date: "2026-01-01",
        last_date: "2026-11-01",
        predicted_next_date: "2026-12-01",
        is_active: true,
        status: "MATURE",
        transaction_ids: s.transaction_ids,
        personal_finance_category: null,
      });
      const streams = item.streams ?? [];
      return { inflow_streams: streams.filter((s) => s.direction === "inflow").map(stream), outflow_streams: streams.filter((s) => s.direction === "outflow").map(stream) };
    },
    "/investments/holdings/get": (body) => {
      const item = this.item(body);
      return {
        accounts: this.accountsOf(item),
        holdings: (item.holdings ?? []).map((h) => ({ ...h, institution_value: h.value, iso_currency_code: "USD" })),
        securities: item.securities ?? [],
      };
    },
    "/investments/transactions/get": (body) => {
      const item = this.item(body);
      const list = item.investmentTransactions ?? [];
      const opts = (body.options ?? {}) as { offset?: number; count?: number };
      const page = list.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.count ?? 100));
      return {
        accounts: this.accountsOf(item),
        securities: item.securities ?? [],
        investment_transactions: page.map((t) => ({
          investment_transaction_id: t.id,
          account_id: t.account_id,
          security_id: t.security_id,
          date: t.date,
          name: t.name,
          quantity: t.quantity,
          amount: t.amount,
          fees: 0,
          type: t.type,
          subtype: t.subtype,
          iso_currency_code: "USD",
        })),
        total_investment_transactions: list.length,
      };
    },
    "/liabilities/get": (body) => {
      const item = this.item(body);
      return {
        accounts: this.accountsOf(item),
        liabilities: {
          credit: (item.credit ?? []).map((c) => ({ ...c, last_statement_issue_date: "2026-11-01" })),
        },
      };
    },
  };
}

class FakeError extends Error {
  readonly type: string;
  readonly code: string;
  constructor(type: string, code: string) {
    super(code);
    this.type = type;
    this.code = code;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A standard checking + credit card item. */
export function bankAccounts(prefix = "a"): FakeAccount[] {
  return [
    { account_id: `${prefix}-checking`, name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", current: 1000.5 },
    { account_id: `${prefix}-card`, name: "Plaid Credit Card", mask: "3333", type: "credit", subtype: "credit card", current: 410.25 },
  ];
}
