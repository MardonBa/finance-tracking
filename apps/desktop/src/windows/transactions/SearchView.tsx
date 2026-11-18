/**
 * Finding a specific charge (§7): search by merchant, description, amount or
 * note, plus date range, account and category filters. Newest first.
 */
import { useEffect, useState } from "react";
import { useQuery } from "../../data/hooks.ts";
import { todayIso } from "../../data/dates.ts";
import { Button, EmptyState, Input, Select } from "../../ui/components.tsx";
import { signed } from "./format.ts";
import { CategoryOptions, type FilterOptions } from "./RowFixes.tsx";
import { TxRow, type Row } from "./TxRow.tsx";

interface ListValue {
  label: string;
  count: number;
  totalCents: number;
  rows: Row[];
}

interface Accounts {
  accounts: { id: string; name: string; hidden: boolean }[];
}

export interface SearchFilters {
  text: string;
  from: string;
  to: string;
  accountId: string;
  category: string;
}

export const NO_FILTERS: SearchFilters = { text: "", from: "", to: "", accountId: "", category: "" };

const PAGE = 200;

export function listParams(f: SearchFilters, limit = PAGE) {
  return {
    measure: "amount",
    includePending: true,
    limit,
    offset: 0,
    ...(f.text.trim() ? { text: f.text.trim() } : {}),
    ...(f.from ? { from: f.from, dateField: "date" } : {}),
    ...(f.to ? { to: f.to, dateField: "date" } : {}),
    ...(f.accountId ? { accountIds: [f.accountId] } : {}),
    ...(f.category ? { categories: [f.category] } : {}),
  };
}

/** Debounce typing so each keystroke doesn't hit the API. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchView({ onAddBank }: { onAddBank?: () => void }) {
  const [f, setF] = useState<SearchFilters>(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const text = useDebounced(f.text);
  const q = useQuery<ListValue>("transactions.list", listParams({ ...f, text }, limit));
  const opts = useQuery<FilterOptions>("transactions.filterOptions", {});
  const accounts = useQuery<Accounts>("accounts.list", { includeHidden: true });
  const set = (patch: Partial<SearchFilters>) => {
    setF({ ...f, ...patch });
    setLimit(PAGE);
  };
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const v = q.data?.value;
  const year = todayIso().slice(0, 4);
  return (
    <div className="tx-view">
      <div className="tx-filters" role="search">
        <Input
          className="tx-filters__search"
          label="Search"
          placeholder="Merchant, description, amount or note"
          type="search"
          value={f.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <Input label="From" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        <Input label="To" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        <Select label="Account" value={f.accountId} onChange={(e) => set({ accountId: e.target.value })}>
          <option value="">All accounts</option>
          {(accounts.data?.value.accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All categories</option>
          <option value="UNCATEGORIZED">Uncategorised</option>
          <CategoryOptions options={opts.data?.value.categories ?? []} />
        </Select>
      </div>
      {v && (
        <div className="tx-summary">
          <span className="tx-muted">
            {v.count} {v.count === 1 ? "transaction" : "transactions"} · net {signed(v.totalCents)}
          </span>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={() => set(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      )}
      {q.error && !v && <EmptyState icon="warning" title="Couldn't load transactions" description={q.error.message} />}
      {!v && !q.error && <p className="tx-muted tx-pad">Loading…</p>}
      {v && v.rows.length === 0 &&
        (filtered ? (
          <EmptyState icon="search" title="Nothing matches" description="Try fewer words, a different amount, or clear the filters." action={{ label: "Clear filters", onClick: () => set(NO_FILTERS) }} />
        ) : (
          <EmptyState
            icon="transactions"
            title="No transactions yet"
            description="Every purchase, paycheck and transfer shows up here once a bank is connected."
            action={onAddBank ? { label: "Add a bank", icon: "plus", onClick: onAddBank } : undefined}
          />
        ))}
      {v && v.rows.length > 0 && (
        <ul className="tx-list" aria-label="Transactions">
          {v.rows.map((r) => (
            <TxRow key={r.transactionId} row={r} currentYear={year} expanded={open === r.transactionId} onToggle={() => setOpen(open === r.transactionId ? null : r.transactionId)} />
          ))}
        </ul>
      )}
      {v && v.count > v.rows.length && (
        <div className="tx-more">
          <Button size="sm" onClick={() => setLimit(Math.min(1000, limit + PAGE))} disabled={limit >= 1000}>
            Show more ({v.count - v.rows.length} more)
          </Button>
        </div>
      )}
    </div>
  );
}
