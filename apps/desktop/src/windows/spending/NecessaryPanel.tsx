/**
 * Necessary vs not (§8): the split for the month (unlabelled is "not set",
 * never guessed), the not-necessary trend, and labelling categories and
 * merchants (no defaults).
 */
import { useState } from "react";
import { monthEnd, monthStart } from "@ft/core";
import { monthLong, monthShort } from "../../data/dates.ts";
import { Button, SegmentedControl, StatNumber } from "../../ui/components.tsx";
import { color } from "../../ui/tokens.ts";
import { money } from "../transactions/format.ts";
import { OneClickResult, useOneClick } from "../transactions/ActionFlow.tsx";
import { useFigures } from "./drill.ts";
import { MiniBars } from "./MiniBars.tsx";

type N = "necessary" | "not_necessary" | "not_set";

interface Split {
  totals: Record<N, number>;
}
interface Trend {
  month: string;
  cents: number;
  notSetCents: number;
}
interface LabelRow {
  targetKind: "category" | "merchant";
  targetValue: string;
  label: string;
  spendCents: number;
  necessity: "necessary" | "not_necessary" | null;
}

const OPTIONS = [
  { value: "necessary" as N, label: "Necessary" },
  { value: "not_necessary" as N, label: "Not necessary" },
  { value: "not_set" as N, label: "Not set" },
];

export function NecessaryPanel({ month }: { month: string }) {
  const range = { from: monthStart(month), to: monthEnd(month) };
  const split = useFigures<Split>("spending.necessity", range);
  const trend = useFigures<Trend[]>("spending.notNecessaryTrend", { endMonth: month, months: 6 });
  const labels = useFigures<{ categories: LabelRow[]; merchants: LabelRow[] }>("spending.necessityLabels", range);
  const [kind, setKind] = useState<"category" | "merchant">("category");
  const [showAll, setShowAll] = useState(false);
  const oc = useOneClick();
  const s = split.value;
  const t = trend.value;
  const l = labels.value;
  if (!s || !t || !l) return <p className="tx-muted">Loading…</p>;
  const rows = kind === "category" ? l.categories : l.merchants;
  const shown = showAll ? rows : rows.slice(0, 8);
  const max = Math.max(0, ...t.map((m) => Math.max(m.cents, m.notSetCents)));
  return (
    <div className="sp-panel">
      <div className="sp-stats">
        <StatNumber label="Necessary" value={money(s.totals.necessary)} onDrillDown={split.drill("necessary")} />
        <StatNumber label="Not necessary" value={money(s.totals.not_necessary)} onDrillDown={split.drill("not_necessary")} />
        <StatNumber label="Not set yet" value={money(s.totals.not_set)} onDrillDown={split.drill("not_set")} detail="Label it below" />
      </div>
      <div className="sp-two">
        <section>
          <h3 className="sp-h">Not necessary, month by month</h3>
          <MiniBars
            ariaLabel="Not-necessary spending by month"
            max={max}
            color={color["pink-600"]}
            bars={t.map((m) => ({
              key: m.month,
              short: monthShort(m.month),
              current: m.month === month,
              label: `Not necessary · ${monthLong(m.month)}: ${money(m.cents)}`,
              value: m.cents,
              onClick: trend.drill(`${m.month}.not_necessary`),
            }))}
          />
        </section>
        <section>
          <h3 className="sp-h">Not set, month by month</h3>
          <MiniBars
            ariaLabel="Unlabelled spending by month"
            max={max}
            color={color["neutral-other"]}
            bars={t.map((m) => ({
              key: m.month,
              short: monthShort(m.month),
              current: m.month === month,
              label: `Not set · ${monthLong(m.month)}: ${money(m.notSetCents)}`,
              value: m.notSetCents,
              onClick: trend.drill(`${m.month}.not_set`),
            }))}
          />
        </section>
      </div>
      <section className="sp-labels">
        <div className="tx-toolbar">
          <h3 className="sp-h">Label what's necessary</h3>
          <span className="tx-spacer" />
          <SegmentedControl
            size="sm"
            label="Label categories or merchants"
            value={kind}
            onChange={setKind}
            options={[
              { value: "category", label: "Categories" },
              { value: "merchant", label: "Merchants" },
            ]}
          />
        </div>
        <OneClickResult oc={oc} />
        <ul className="sp-label-list">
          {shown.map((r) => (
            <li key={r.targetValue}>
              <span className="sp-label-list__name">{r.label}</span>
              <button type="button" className="sp-inline-drill" onClick={labels.drill(`${r.targetKind}.${r.targetValue}`)} aria-label={`${r.label}: ${money(r.spendCents)}. Show transactions`}>
                {money(r.spendCents)}
              </button>
              <SegmentedControl<N>
                size="sm"
                label={`Is ${r.label} necessary?`}
                value={r.necessity ?? "not_set"}
                options={OPTIONS}
                onChange={(v) => void oc.run("spending.setNecessityLabel", { targetKind: r.targetKind, targetValue: r.targetValue, necessity: v === "not_set" ? null : v })}
              />
            </li>
          ))}
        </ul>
        {rows.length > 8 && (
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        )}
      </section>
    </div>
  );
}
