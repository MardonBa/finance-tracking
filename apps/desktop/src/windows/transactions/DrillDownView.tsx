/**
 * What's behind a number (§7): re-runs `transactions.drillDown` with the
 * clicked figure, shows exactly its transactions under the filter header and
 * a total that equals the number clicked. Split parts and linked refunds sit
 * with their parent purchase.
 */
import { useState } from "react";
import type { Flows } from "@ft/core";
import type { DrillDownRequest } from "../../data/drilldown.ts";
import { useQuery } from "../../data/hooks.ts";
import { dayLabel } from "../../data/dates.ts";
import { EmptyState } from "../../ui/components.tsx";
import { money, signed } from "./format.ts";
import { TxRow } from "./TxRow.tsx";

export function DrillDownView({ req }: { req: DrillDownRequest }) {
  const q = useQuery<Flows.DrillDown>("transactions.drillDown", { query: req.query, params: req.params, figure: req.figureId });
  const [open, setOpen] = useState<string | null>(null);
  const v = q.data?.value;
  if (q.error && !v) return <EmptyState icon="warning" title="Couldn't load these transactions" description={q.error.message} />;
  if (!v) return <p className="tx-muted tx-pad">Loading…</p>;
  return (
    <div className="tx-view">
      <div className="tx-summary" aria-live="polite">
        <span className="tx-summary__total" data-testid="drill-total">
          {money(v.totalCents)}
        </span>
        <span className="tx-muted">
          {v.count} {v.count === 1 ? "transaction" : "transactions"}
        </span>
      </div>
      {v.groups.length === 0 ? (
        <EmptyState icon="transactions" title="No transactions behind this number" description="It's zero: nothing cleared in this filter yet." />
      ) : (
        <ul className="tx-list" aria-label={`Transactions: ${req.label}`}>
          {v.groups.map((g) => {
            const parts = g.row.parts.filter((p) => p.splitId && g.partCents[p.splitId] !== undefined);
            const refunds = g.row.refunds.filter((r) => g.refundCents[r.transactionId] !== undefined);
            const whole = Math.abs(g.row.amountCents) === Math.abs(g.totalCents) && parts.length === 0 && refunds.length === 0;
            return (
              <TxRow
                key={g.row.transactionId}
                row={g.row}
                expanded={open === g.row.transactionId}
                onToggle={() => setOpen(open === g.row.transactionId ? null : g.row.transactionId)}
                counted={
                  <span className="tx-counted" data-testid="group-total">
                    {money(g.totalCents)}
                    {!whole && <span className="tx-counted__of">of {signed(g.row.amountCents)}</span>}
                  </span>
                }
              >
                {(parts.length > 0 || refunds.length > 0) && (
                  <ul className="tx-sublines">
                    {parts.map((p) => (
                      <li key={p.key}>
                        <span>Split part · {p.categoryLabel}</span>
                        <span>{money(g.partCents[p.splitId!]!)}</span>
                      </li>
                    ))}
                    {g.ownCents !== 0 && parts.length === 0 && refunds.length > 0 && (
                      <li>
                        <span>Purchase</span>
                        <span>{money(g.ownCents)}</span>
                      </li>
                    )}
                    {refunds.map((r) => (
                      <li key={r.transactionId}>
                        <span>
                          Refund · {dayLabel(r.date)} · {r.merchantName}
                        </span>
                        <span>{money(g.refundCents[r.transactionId]!)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TxRow>
            );
          })}
        </ul>
      )}
    </div>
  );
}
