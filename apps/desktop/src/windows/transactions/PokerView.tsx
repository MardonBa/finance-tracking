/**
 * Poker summary (§6): money in, money out and the net result for a period.
 * The individual Poker transactions are neither spending nor income; only the
 * net counts as one "Poker" income line. Each number drills down.
 */
import { useState } from "react";
import { monthOf, type IsoMonth } from "@ft/core";
import { todayIso } from "../../data/dates.ts";
import { EmptyState, StatNumber } from "../../ui/components.tsx";
import { useFigures } from "../spending/drill.ts";
import { MonthPicker, monthRange } from "./BalanceCheckView.tsx";
import { money, signed } from "./format.ts";

interface PokerValue {
  inCents: number;
  outCents: number;
  netCents: number;
  count: number;
}

export function PokerView() {
  const today = todayIso();
  const [month, setMonth] = useState<IsoMonth>(monthOf(today));
  const q = useFigures<PokerValue>("flows.poker", monthRange(month, today));
  const v = q.value;
  return (
    <div className="tx-view" data-testid="poker-summary">
      <div className="tx-check__head">
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      {q.error && !v ? (
        <EmptyState icon="warning" title="Couldn't load the Poker summary" description={q.error.message} />
      ) : !v ? (
        <p className="tx-muted tx-pad">Loading…</p>
      ) : v.count === 0 ? (
        <EmptyState
          icon="cash"
          title="No Poker this month"
          description="Mark a transaction as Poker from its row (or with a rule for a payer); buy-ins and payouts then show here, and only the net counts as income."
        />
      ) : (
        <>
          <div className="tx-poker">
            <StatNumber label="Money in" value={money(v.inCents)} onDrillDown={q.drill("in")} />
            <StatNumber label="Money out" value={money(v.outCents)} onDrillDown={q.drill("out")} />
            <StatNumber label="Net result" value={signed(v.netCents)} size="lg" onDrillDown={q.drill("net")} detail={v.netCents < 0 ? "A loss: counts as negative income" : "Counts as income"} />
          </div>
          <p className="tx-muted">
            {v.count} Poker {v.count === 1 ? "transaction" : "transactions"}. They're kept out of spending and income; only the net result is added to income as one "Poker" line.
          </p>
        </>
      )}
    </div>
  );
}
