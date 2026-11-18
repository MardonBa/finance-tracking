/**
 * Planning (design.md §5): per account, drag-to-reorder priorities with live
 * projected dates (goals.whatIf), a what-if contribution slider, and the
 * account bar split by goal (protected, each goal with its target,
 * unassigned). Reordering runs goals.reorder with an Undo.
 */
import { useState } from "react";
import type { Goals } from "@ft/core";
import { useActions, useQuery } from "../../data/hooks.ts";
import { Button } from "../../ui/components.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { shortDate, usd } from "../budgets/format.ts";
import { goalColor } from "./goalColors.ts";
import { ReorderList } from "./ReorderList.tsx";
import type { AccountBarsValue, GoalCardValue, WhatIfValue } from "./types.ts";

export function PlanView({ goals }: { goals: GoalCardValue[] }) {
  const bars = useQuery<AccountBarsValue>("goals.accountBars", {});
  const accounts = [...new Map(goals.map((g) => [g.accountId, g.accountName])).entries()];
  return (
    <div className="gl-plan">
      {accounts.map(([accountId, accountName]) => (
        <AccountPlan
          key={accountId}
          accountId={accountId}
          accountName={accountName}
          goals={goals.filter((g) => g.accountId === accountId).sort((a, b) => a.priority - b.priority)}
          bar={bars.data?.value.accounts.find((a) => a.accountId === accountId)}
        />
      ))}
    </div>
  );
}

function AccountPlan({
  accountId,
  accountName,
  goals,
  bar,
}: {
  accountId: string;
  accountName: string;
  goals: GoalCardValue[];
  bar: AccountBarsValue["accounts"][number] | undefined;
}) {
  const actions = useActions();
  const [preview, setPreview] = useState<string[] | null>(null);
  const [delta, setDelta] = useState(0);
  const [toast, setToast] = useState<{ text: string; logId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const whatIf = useQuery<WhatIfValue>("goals.whatIf", { accountId, contributionDeltaCents: delta, ...(preview ? { order: preview } : {}) });
  const result = whatIf.data?.value.result ?? null;
  const live = preview !== null || delta !== 0;

  const commit = async (ids: string[]) => {
    setError(null);
    try {
      const res = await actions.run("goals.reorder", { accountId, goalIds: ids });
      const order = res.preview.changes.find((c) => c.label === "Order");
      setToast({ text: order ? `New order: ${order.after}` : "Priorities updated", logId: res.logId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reorder.");
    }
  };

  const projectionFor = (goalId: string) => {
    const s = result?.scenario.find((p) => p.goalId === goalId);
    const shift = result?.shiftDays[goalId] ?? null;
    if (!s) return null;
    return { date: s.projectedDate, complete: s.alreadyComplete, shift };
  };

  return (
    <section className="gl-account" aria-labelledby={`plan-${accountId}`}>
      <div className="gl-account__head">
        <h3 id={`plan-${accountId}`} className="bg-section-title">
          {accountName}
        </h3>
        {bar && <span className="gl-muted">{usd(bar.balanceCents)} balance</span>}
      </div>

      <AccountBar goals={goals} bar={bar} scenario={live ? (result?.scenarioAllocation ?? null) : null} />

      <p className="gl-muted gl-hint">Drag the handles (or focus one and use the arrow keys) to change which goal is funded first.</p>
      <ReorderList
        label={`Goal priorities in ${accountName}`}
        items={goals.map((g) => ({ id: g.goalId, label: g.name, goal: g }))}
        onPreview={setPreview}
        onCommit={commit}
        render={(item, i) => {
          const p = projectionFor(item.id);
          return (
            <div className="gl-plan-row" style={{ ["--_goal" as string]: goalColor(item.goal.colorSlot) }}>
              <span className="gl-plan-row__rank">{i + 1}</span>
              <span className="gl-swatch" aria-hidden="true" />
              <span className="gl-plan-row__name">{item.goal.name}</span>
              <span className="gl-muted">
                {usd(item.goal.savedCents)} / {usd(item.goal.targetCents)}
              </span>
              <span className="gl-plan-row__date" data-testid={`projected-${item.id}`}>
                {p === null ? item.goal.projection.label : p.complete ? "Funded" : p.date ? `Projected ${shortDate(p.date)}` : "No projected date"}
                {p?.shift ? <span className={p.shift < 0 ? "gl-sooner" : "gl-later"}>{p.shift < 0 ? ` ▲ ${-p.shift} days sooner` : ` ▼ ${p.shift} days later`}</span> : null}
              </span>
            </div>
          );
        }}
      />

      <div className="gl-whatif">
        <label className="gl-whatif__label" htmlFor={`whatif-${accountId}`}>
          What if I put in <strong>{delta === 0 ? "the same" : `${delta > 0 ? "+" : "−"}${usd(Math.abs(delta))}/month`}</strong>
          {result?.baseline && whatIf.data && <span className="gl-muted"> · recent rate {rateText(goals[0]?.accountMonthlyRateCents ?? null)}</span>}
        </label>
        <input
          id={`whatif-${accountId}`}
          type="range"
          min={-50000}
          max={100000}
          step={2500}
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value))}
          aria-valuetext={delta === 0 ? "No change" : `${delta > 0 ? "plus" : "minus"} ${usd(Math.abs(delta))} per month`}
          className="gl-whatif__slider"
        />
        {delta !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => setDelta(0)}>
            Reset
          </Button>
        )}
      </div>

      {error && (
        <p className="ui-confirm__error" role="alert">
          <Icon name="warning" size={16} /> {error}
        </p>
      )}
      {toast && (
        <div className="gl-toast" role="status">
          <Icon name="check" size={16} /> <span>{toast.text}</span>
          <Button
            size="sm"
            onClick={async () => {
              await actions.undo(toast.logId);
              setToast(null);
            }}
          >
            Undo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setToast(null)} aria-label="Dismiss">
            OK
          </Button>
        </div>
      )}
    </section>
  );
}

const rateText = (c: number | null) => (c === null ? "unknown" : `${usd(c)}/month`);

/** One bar: protected, a slot per goal (width = target, fill = assigned), unassigned. */
function AccountBar({ goals, bar, scenario }: { goals: GoalCardValue[]; bar: AccountBarsValue["accounts"][number] | undefined; scenario: Goals.AccountAllocation | null }) {
  if (!bar) return null;
  type Seg = { key: string; kind: "protected" | "goal" | "unassigned"; label: string; cents: number; slot: number; color?: string };
  const segs: Seg[] = [];
  if (scenario) {
    if (scenario.protectedTargetCents > 0) segs.push({ key: "protected", kind: "protected", label: "Protected", cents: scenario.protectedCents, slot: scenario.protectedTargetCents });
    for (const ga of scenario.goals) {
      const g = goals.find((x) => x.goalId === ga.goalId);
      segs.push({ key: ga.goalId, kind: "goal", label: g?.name ?? ga.goalId, cents: ga.allocatedCents, slot: ga.targetCents, color: g ? goalColor(g.colorSlot) : undefined });
    }
    segs.push({ key: "unassigned", kind: "unassigned", label: "Unassigned", cents: scenario.unassignedCents, slot: scenario.unassignedCents });
  } else {
    for (const s of bar.segments) {
      if (s.kind === "protected") segs.push({ key: "protected", kind: "protected", label: "Protected", cents: s.cents, slot: s.targetCents });
      else if (s.kind === "goal") segs.push({ key: s.goalId, kind: "goal", label: s.name, cents: s.cents, slot: s.targetCents, color: goalColor(s.colorSlot) });
      else segs.push({ key: "unassigned", kind: "unassigned", label: "Unassigned", cents: s.cents, slot: s.cents });
    }
  }
  return (
    <figure className="gl-bar" aria-label={`${bar.accountName} split by goal`}>
      <div className="gl-bar__track">
        {segs
          .filter((s) => s.slot > 0)
          .map((s) => (
            <div key={s.key} className={`gl-bar__slot gl-bar__slot--${s.kind}`} style={{ flexGrow: s.slot, ["--_goal" as string]: s.color }} title={`${s.label}: ${usd(s.cents)}${s.kind === "unassigned" ? "" : ` of ${usd(s.slot)}`}`}>
              <div className="gl-bar__fill" style={{ width: `${s.slot ? (s.cents / s.slot) * 100 : 0}%` }} />
            </div>
          ))}
      </div>
      <figcaption className="gl-bar__legend">
        {segs.map((s, i) => (
          <span key={s.key} className={`gl-bar__key gl-bar__key--${s.kind}`} style={{ ["--_goal" as string]: s.color }}>
            <span className="gl-bar__dot" aria-hidden="true" />
            {s.kind === "goal" ? `${i + (segs[0]?.kind === "protected" ? 0 : 1)}. ` : ""}
            {s.label} {usd(s.cents)}
            {s.kind !== "unassigned" && s.cents < s.slot ? <span className="gl-muted"> / {usd(s.slot)}</span> : s.kind === "goal" ? " ✓" : ""}
          </span>
        ))}
      </figcaption>
      {bar.warning && (
        <p className="bg-warning">
          <Icon name="warning" size={16} /> {bar.warning}
        </p>
      )}
    </figure>
  );
}
