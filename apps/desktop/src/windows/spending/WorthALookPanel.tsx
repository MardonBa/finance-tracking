/**
 * Places to improve (§8, rule-based): "Worth a look" with the numbers behind
 * each, and the cutting-back list with month-by-month results.
 */
import type { Spending } from "@ft/core";
import { monthLong, monthShort } from "../../data/dates.ts";
import { Button, EmptyState, StatusLabel } from "../../ui/components.tsx";
import { money, signed } from "../transactions/format.ts";
import { OneClickResult, useOneClick } from "../transactions/ActionFlow.tsx";
import { useFigures } from "./drill.ts";

const KIND_TITLE: Record<Spending.WorthALookKind, string> = {
  category_pace: "Above usual pace",
  rising_merchant: "Rising merchant",
  small_frequent: "Small purchases adding up",
  new_recurring: "New recurring charge",
  price_increase: "Price went up",
};

export function WorthALookPanel({ month, usualMonths }: { month: string; usualMonths: 1 | 2 | 3 }) {
  const w = useFigures<{ basis: Spending.UsualBasis; items: Spending.WorthALookItem[] }>("spending.worthALook", { month, usualMonths });
  const c = useFigures<Spending.CuttingBackProgress[]>("spending.cuttingBack", { throughMonth: month });
  const oc = useOneClick();
  const wv = w.value;
  const cv = c.value;
  if (!wv || !cv) return <p className="tx-muted">Loading…</p>;
  const tracked = new Set(cv.filter((x) => x.endedOn === null).map((x) => `${x.targetKind}:${x.targetValue}`));
  return (
    <div className="sp-panel">
      <OneClickResult oc={oc} />
      <section>
        <h3 className="sp-h">Worth a look</h3>
        {wv.items.length === 0 ? (
          <EmptyState icon="check" title="Nothing stands out this month" description={`Compared with usual (${wv.basis.label}), spending looks normal.`} />
        ) : (
          <ul className="sp-worth">
            {wv.items.map((it) => {
              const target = it.target.kind === "recurring" ? null : it.target;
              const onList = target ? tracked.has(`${target.kind}:${target.value}`) : false;
              return (
                <li key={it.id} className="sp-worth__item">
                  <span className="sp-worth__kind">{KIND_TITLE[it.kind]}</span>
                  <p className="sp-worth__text">{it.text}</p>
                  <div className="tx-toolbar">
                    {it.figure && (
                      <Button size="sm" onClick={w.drill(it.figure)}>
                        Show the {money(it.cents)}
                      </Button>
                    )}
                    {target &&
                      (onList ? (
                        <span className="tx-muted tx-small">On your cutting-back list</span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => void oc.run("spending.addCuttingBack", { targetKind: target.kind, targetValue: target.value })}>
                          Cut back on this
                        </Button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h3 className="sp-h">Cutting back</h3>
        {cv.length === 0 ? (
          <EmptyState title="Nothing on your cutting-back list" description="Choose “Cut back on this” on anything above to track, month by month, whether it goes down." />
        ) : (
          <ul className="sp-cut">
            {cv.map((x) => (
              <li key={x.id} className="sp-cut__item">
                <div className="tx-toolbar">
                  <strong>{x.label}</strong>
                  <span className="tx-muted tx-small">
                    {x.baselineCents === null ? "No months before it to compare with" : `Before: ${money(x.baselineCents)} a month (${x.baselineMonths.map(monthShort).join(", ")})`}
                  </span>
                  <span className="tx-spacer" />
                  {x.endedOn === null ? (
                    <Button size="sm" variant="ghost" onClick={() => void oc.run("spending.removeCuttingBack", { id: x.id })}>
                      Stop tracking
                    </Button>
                  ) : (
                    <span className="tx-muted tx-small">Stopped {x.endedOn}</span>
                  )}
                </div>
                <div className="sp-cut__months">
                  {x.months.map((m) => {
                    const drill = c.drill(`${x.id}.${m.month}`);
                    return (
                      <div key={m.month} className="sp-cut__month">
                        <span className="tx-small tx-muted">{monthLong(m.month)}</span>
                        <button type="button" className="sp-inline-drill" onClick={drill} disabled={!drill} aria-label={`${x.label} · ${monthLong(m.month)}: ${money(m.cents)}. Show transactions`}>
                          {money(m.cents)}
                        </button>
                        {m.wentDown === null ? null : m.wentDown ? (
                          <StatusLabel status="under">Down {signed(m.diffCents ?? 0)}</StatusLabel>
                        ) : (
                          <StatusLabel status="over">Not down ({signed(m.diffCents ?? 0)})</StatusLabel>
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
