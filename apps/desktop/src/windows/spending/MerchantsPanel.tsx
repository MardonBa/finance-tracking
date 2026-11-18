/** Top merchants with trend lines (§8): merchant, period total, count and a 12-month line. */
import { monthEnd, monthStart, type Spending } from "@ft/core";
import { openMerchant } from "../../data/drilldown.ts";
import { monthLong } from "../../data/dates.ts";
import { EmptyState } from "../../ui/components.tsx";
import { money } from "../transactions/format.ts";
import { Sparkline } from "../transactions/Sparkline.tsx";
import { useFigures } from "./drill.ts";

export function MerchantsPanel({ month }: { month: string }) {
  const q = useFigures<Spending.MerchantTrend[]>("spending.topMerchants", { from: monthStart(month), to: monthEnd(month), limit: 10, trendMonths: 12 });
  const v = q.value;
  if (!v) return <p className="tx-muted">Loading…</p>;
  if (v.length === 0) return <EmptyState icon="spending" title="No merchants this month" description="Your top merchants appear once purchases clear." />;
  return (
    <div className="sp-panel">
      <table className="sp-table">
        <thead>
          <tr>
            <th scope="col">Merchant</th>
            <th scope="col" className="sp-num">
              {monthLong(month)}
            </th>
            <th scope="col" className="sp-num">
              Purchases
            </th>
            <th scope="col">Last 12 months</th>
          </tr>
        </thead>
        <tbody>
          {v.map((m) => (
            <tr key={m.merchantKey}>
              <td>
                <button type="button" className="tx-link" onClick={() => openMerchant({ merchantKey: m.merchantKey, label: m.name })}>
                  {m.name}
                </button>
              </td>
              <td className="sp-num">
                <button type="button" className="sp-inline-drill" onClick={q.drill(`${m.merchantKey}.total`)} aria-label={`${m.name}: ${money(m.totalCents)}. Show transactions`}>
                  {money(m.totalCents)}
                </button>
              </td>
              <td className="sp-num">{m.count}</td>
              <td className="sp-spark-cell">
                <Sparkline
                  ariaLabel={`${m.name}, monthly over 12 months`}
                  points={m.trend.map((t) => ({ key: t.month, value: t.cents, label: `${m.name} · ${monthLong(t.month)}: ${money(t.cents)}`, onClick: q.drill(`${m.merchantKey}.${t.month}`) }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
