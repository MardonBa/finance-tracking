/**
 * Everything from a merchant (§7): all its transactions, the total and count
 * for a period, a 12-month trend, and merge / separate when grouping is wrong.
 */
import { useEffect, useState } from "react";
import { addMonthsToMonth, monthEnd, monthOf, monthStart } from "@ft/core";
import { openDrillDown, openMerchant, type MerchantRequest } from "../../data/drilldown.ts";
import { useQuery } from "../../data/hooks.ts";
import { monthLong, todayIso } from "../../data/dates.ts";
import { Button, EmptyState, Input, SegmentedControl, Select, StatNumber } from "../../ui/components.tsx";
import { ActionFlowPanel, useActionFlow } from "./ActionFlow.tsx";
import { money } from "./format.ts";
import { Sparkline } from "./Sparkline.tsx";
import { TxRow, type Row } from "./TxRow.tsx";

type Period = "month" | "3m" | "12m";

interface MerchantValue {
  merchantKey: string;
  name: string;
  totalCents: number;
  count: number;
  trend: { month: string; cents: number }[];
  rows: Row[];
  rawNames: string[];
}

interface MerchantListItem {
  merchantKey: string;
  name: string;
  spendCents: number;
}

export function periodRange(period: Period, today = todayIso()): { from: string; to: string; label: string } {
  const m = monthOf(today);
  const back = period === "month" ? 0 : period === "3m" ? 2 : 11;
  const first = addMonthsToMonth(m, -back);
  return {
    from: monthStart(first),
    to: monthEnd(m),
    label: period === "month" ? monthLong(m) : `${monthLong(first)} – ${monthLong(m)}`,
  };
}

export function MerchantView({ req }: { req: MerchantRequest }) {
  // TODO(revisit): the merchant view opens on the last 12 months.
  const [period, setPeriod] = useState<Period>("12m");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<"merge" | "separate" | null>(null);
  const range = periodRange(period);
  const params = { from: range.from, to: range.to, merchantKey: req.merchantKey, trendMonths: 12 };
  const q = useQuery<MerchantValue>("transactions.merchant", params);
  const v = q.data?.value;
  const figures = q.data?.figures ?? {};
  if (q.error && !v) return <EmptyState icon="warning" title="Couldn't load this merchant" description={q.error.message} />;
  if (!v) return <p className="tx-muted tx-pad">Loading…</p>;
  const drill = (figureId: string) => {
    const f = figures[figureId];
    if (f) openDrillDown({ query: "transactions.merchant", params, figureId, label: f.label ?? `${v.name} · ${figureId}` });
  };
  const year = todayIso().slice(0, 4);
  return (
    <div className="tx-view">
      <div className="tx-merchant-head">
        <StatNumber label={`Total · ${range.label}`} value={money(v.totalCents)} onDrillDown={() => drill("total")} />
        <StatNumber label="Transactions" value={String(v.count)} />
        <div className="tx-merchant-trend">
          <span className="tx-muted tx-small">Last 12 months</span>
          <Sparkline
            ariaLabel={`${v.name}, monthly over the last 12 months`}
            height={40}
            points={v.trend.map((t) => ({
              key: t.month,
              value: t.cents,
              label: `${monthLong(t.month)}: ${money(t.cents)}`,
              onClick: () => drill(`month.${t.month}`),
            }))}
          />
        </div>
      </div>
      <div className="tx-toolbar">
        <SegmentedControl<Period>
          size="sm"
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "month", label: "This month" },
            { value: "3m", label: "3 months" },
            { value: "12m", label: "12 months" },
          ]}
        />
        <span className="tx-spacer" />
        <Button size="sm" variant="ghost" pressed={editing === "merge"} onClick={() => setEditing(editing === "merge" ? null : "merge")}>
          Merge with…
        </Button>
        {v.rawNames.length > 1 && (
          <Button size="sm" variant="ghost" pressed={editing === "separate"} onClick={() => setEditing(editing === "separate" ? null : "separate")}>
            Separate names…
          </Button>
        )}
      </div>
      {editing === "merge" && <MergeEditor merchant={v} />}
      {editing === "separate" && <SeparateEditor merchant={v} />}
      {v.rows.length === 0 ? (
        <EmptyState icon="transactions" title={`No transactions from ${v.name}`} description="Once one imports it shows up here." />
      ) : (
        <ul className="tx-list" aria-label={`Transactions from ${v.name}`}>
          {v.rows.map((r) => (
            <TxRow
              key={r.transactionId}
              row={r}
              currentYear={year}
              expanded={open === r.transactionId}
              onToggle={() => setOpen(open === r.transactionId ? null : r.transactionId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MergeEditor({ merchant }: { merchant: MerchantValue }) {
  const range = periodRange("12m");
  const list = useQuery<MerchantListItem[]>("transactions.merchants", { from: range.from, to: range.to });
  const others = (list.data?.value ?? []).filter((m) => m.merchantKey !== merchant.merchantKey);
  const [other, setOther] = useState("");
  const [name, setName] = useState(merchant.name);
  const flow = useActionFlow();
  // After a merge the old key is gone: follow the merchant to its new group.
  const phase = flow.phase;
  useEffect(() => {
    if (phase.kind !== "done" || phase.undone) return;
    const m = (list.data?.value ?? []).find((x) => x.name === name.trim() && !x.merchantKey.startsWith("auto:"));
    if (m && m.merchantKey !== merchant.merchantKey) openMerchant({ merchantKey: m.merchantKey, label: m.name });
  }, [phase, list.data, name, merchant.merchantKey]);
  return (
    <div className="tx-editor">
      <div className="tx-fix">
        <Select label={`Merge ${merchant.name} with`} value={other} onChange={(e) => setOther(e.target.value)}>
          <option value="">Choose a merchant…</option>
          {others.map((m) => (
            <option key={m.merchantKey} value={m.merchantKey}>
              {m.name}
            </option>
          ))}
        </Select>
        <Input label="Name for the merged merchant" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          size="sm"
          variant="primary"
          disabled={!other || !name.trim()}
          onClick={() => void flow.propose({ name: "transactions.mergeMerchants", input: { merchantKeys: [merchant.merchantKey, other], name: name.trim() } })}
        >
          Preview merge
        </Button>
      </div>
      <ActionFlowPanel flow={flow} />
    </div>
  );
}

function SeparateEditor({ merchant }: { merchant: MerchantValue }) {
  const [raw, setRaw] = useState(merchant.rawNames[0] ?? "");
  const [name, setName] = useState("");
  const flow = useActionFlow();
  const tx = merchant.rows.find((r) => r.rawDescription === raw);
  return (
    <div className="tx-editor">
      <div className="tx-fix">
        <Select label="Bank name to take out" value={raw} onChange={(e) => setRaw(e.target.value)}>
          {merchant.rawNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Input label="Its own merchant name" placeholder="e.g. Amazon returns" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          size="sm"
          variant="primary"
          disabled={!tx || !name.trim()}
          onClick={() => tx && void flow.propose({ name: "transactions.separateMerchant", input: { transactionId: tx.transactionId, name: name.trim() } })}
        >
          Preview separate
        </Button>
      </div>
      <ActionFlowPanel flow={flow} />
    </div>
  );
}
