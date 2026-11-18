/**
 * How I save (§8): money moved into savings and investment accounts each
 * month, by destination (not hidden as transfers), and the savings rate
 * month over month.
 */
import type { Spending } from "@ft/core";
import { monthLong, monthShort } from "../../data/dates.ts";
import { EmptyState } from "../../ui/components.tsx";
import { color, seriesColors } from "../../ui/tokens.ts";
import { money, moneyShort, pct } from "../transactions/format.ts";
import { useFigures } from "./drill.ts";
import { MiniBars } from "./MiniBars.tsx";

export function SavingPanel({ month }: { month: string }) {
  const dest = useFigures<Spending.SavedDestination[]>("spending.savedByDestination", { endMonth: month, months: 6 });
  const flow = useFigures<Spending.MonthTotals[]>("spending.cashFlow", { endMonth: month, months: 12 });
  const d = dest.value;
  const f = flow.value;
  if (!d || !f) return <p className="tx-muted">Loading…</p>;
  const destMax = Math.max(0, ...d.flatMap((x) => x.months.map((m) => m.cents)));
  const savedMax = Math.max(0, ...f.map((m) => m.savedCents));
  return (
    <div className="sp-panel sp-saving">
      <section>
        <h3 className="sp-h">Savings rate, month over month</h3>
        <MiniBars
          ariaLabel="Saved each month, with the savings rate above"
          max={savedMax}
          color={color["status-ok"]}
          height={64}
          bars={f.map((m) => ({
            key: m.month,
            short: monthShort(m.month),
            top: pct(m.savingsRate),
            current: m.month === month,
            label: `${monthLong(m.month)}: saved ${money(m.savedCents)} of ${money(m.incomeCents)} income (${pct(m.savingsRate)})`,
            value: Math.max(0, m.savedCents),
            onClick: flow.drill(`${m.month}.saved`),
          }))}
        />
      </section>
      <section>
        <h3 className="sp-h">Saved by destination</h3>
        {d.length === 0 ? (
          <EmptyState icon="investments" title="No savings or investment accounts" description="Link a savings or brokerage account to see what you move into it each month." />
        ) : (
          <div className="sp-dest">
            {d.map((x, i) => (
              <div key={x.accountId} className="sp-multiple">
                <div className="sp-multiple__head">
                  <span>
                    {x.name} <span className="tx-muted tx-small">{x.kind === "savings" ? "savings" : "investments"}</span>
                  </span>
                  <span className="sp-multiple__value">{moneyShort(x.totalCents)}</span>
                </div>
                <MiniBars
                  ariaLabel={`Saved into ${x.name}`}
                  max={destMax}
                  color={seriesColors[i % seriesColors.length]!}
                  height={44}
                  bars={x.months.map((m) => ({
                    key: m.month,
                    short: monthShort(m.month).slice(0, 1),
                    current: m.month === month,
                    label: `Into ${x.name} · ${monthLong(m.month)}: ${money(m.cents)}`,
                    value: Math.max(0, m.cents),
                    onClick: dest.drill(`${x.accountId}.${m.month}`),
                  }))}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
