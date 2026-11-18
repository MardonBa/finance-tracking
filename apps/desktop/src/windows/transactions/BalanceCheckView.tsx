/**
 * "Do the numbers add up?" (§6): per account, start balance + money in −
 * money out vs the end balance from snapshots, with any difference shown as
 * "unexplained" on that account, never hidden. Below it, the same check
 * across everything (income − spending ± transfers ± investment change vs the
 * change in net worth) with any leftover.
 *
 * Money in / out and the equation's terms drill down to their transactions.
 * The unexplained difference itself has no transactions behind it (that's
 * what makes it unexplained), so it isn't clickable.
 */
import { useState } from "react";
import { addMonthsToMonth, monthEnd, monthOf, monthStart, type IsoMonth } from "@ft/core";
import { todayIso, monthLong } from "../../data/dates.ts";
import { useQuery } from "../../data/hooks.ts";
import { EmptyState, Select, StatusLabel } from "../../ui/components.tsx";
import { useFigures } from "../spending/drill.ts";
import { money, signed } from "./format.ts";

interface AccountRec {
  accountId: string;
  isInvestment: boolean;
  status: "ok" | "unexplained" | "missing_snapshot";
  startDate: string | null;
  endDate: string | null;
  startBalanceCents: number | null;
  endBalanceCents: number | null;
  inCents: number;
  outCents: number;
  expectedEndCents: number | null;
  unexplainedCents: number;
  marketChangeCents: number;
}

interface Equation {
  accountIds: string[];
  missingSnapshotAccountIds: string[];
  changeCents: number;
  incomeCents: number;
  spendingCents: number;
  pokerNetCents: number;
  transfersNetCents: number;
  investmentChangeCents: number;
  leftoverCents: number;
}

/** The period: the month so far (as the Overview counts it) or a full past month. */
export function monthRange(month: IsoMonth, today: string): { from: string; to: string } {
  const end = monthEnd(month);
  return { from: monthStart(month), to: end < today ? end : today };
}

export function MonthPicker({ month, onChange, label = "Month" }: { month: IsoMonth; onChange: (m: IsoMonth) => void; label?: string }) {
  const current = monthOf(todayIso());
  const months = Array.from({ length: 12 }, (_, i) => addMonthsToMonth(current, -i));
  return (
    <Select label={label} value={month} onChange={(e) => onChange(e.target.value as IsoMonth)}>
      {months.map((m, i) => (
        <option key={m} value={m}>
          {i === 0 ? `This month (${monthLong(m)})` : monthLong(m)}
        </option>
      ))}
    </Select>
  );
}

export function BalanceCheckView() {
  const today = todayIso();
  const [month, setMonth] = useState<IsoMonth>(monthOf(today));
  const range = monthRange(month, today);
  const rec = useFigures<{ accounts: AccountRec[]; unexplainedCount: number }>("flows.reconciliation", range);
  const eq = useFigures<Equation>("flows.netWorthEquation", range);
  const accounts = useQuery<{ accounts: { id: string; name: string }[] }>("accounts.list", { includeHidden: true });
  const nameOf = (id: string) => accounts.data?.value.accounts.find((a) => a.id === id)?.name ?? id;

  const v = rec.value;
  if (rec.error && !v) return <EmptyState icon="warning" title="Couldn't check the balances" description={rec.error.message} />;
  if (!v) return <p className="tx-muted tx-pad">Loading…</p>;
  const sorted = [...v.accounts].sort((a, b) => rank(a) - rank(b) || nameOf(a.accountId).localeCompare(nameOf(b.accountId)));

  return (
    <div className="tx-view" data-testid="balance-check">
      <div className="tx-check__head">
        <MonthPicker month={month} onChange={setMonth} />
        <p className="tx-muted">
          {v.unexplainedCount === 0
            ? "Every account's balance is explained by its transactions."
            : `${v.unexplainedCount} ${v.unexplainedCount === 1 ? "account has" : "accounts have"} a difference the transactions don't explain.`}
        </p>
      </div>
      {v.accounts.length === 0 ? (
        <EmptyState icon="bank" title="No accounts to check" description="Add a bank or a manual account; its balances are checked against its transactions here." />
      ) : (
        <ul className="tx-check" aria-label="Balance check by account">
          {sorted.map((a) => {
            const name = nameOf(a.accountId);
            return (
              <li key={a.accountId} className="tx-check__item" data-testid={`check-${a.accountId}`}>
                <div className="tx-check__title">
                  <strong>{name}</strong>
                  {a.status === "unexplained" && <StatusLabel status="warning">Unexplained {signed(a.unexplainedCents)}</StatusLabel>}
                  {a.status === "ok" && <StatusLabel status="on-track">Adds up</StatusLabel>}
                  {a.status === "missing_snapshot" && <span className="tx-muted">No balances to check yet</span>}
                </div>
                {a.status !== "missing_snapshot" && (
                  <dl className="tx-check__sum">
                    <dt>Balance {a.startDate}</dt>
                    <dd className="ft-num">{money(a.startBalanceCents ?? 0)}</dd>
                    <dt>Money in</dt>
                    <dd>
                      <DrillAmount label={`${name} money in`} cents={a.inCents} onClick={rec.drill(`${a.accountId}.in`)} prefix="+" />
                    </dd>
                    <dt>Money out</dt>
                    <dd>
                      <DrillAmount label={`${name} money out`} cents={a.outCents} onClick={rec.drill(`${a.accountId}.out`)} prefix="−" />
                    </dd>
                    <dt>Expected balance {a.endDate}</dt>
                    <dd className="ft-num">{money(a.expectedEndCents ?? 0)}</dd>
                    <dt>Actual balance {a.endDate}</dt>
                    <dd className="ft-num">{money(a.endBalanceCents ?? 0)}</dd>
                    {a.isInvestment ? (
                      <>
                        <dt>Market change</dt>
                        <dd className="ft-num">{signed(a.marketChangeCents)}</dd>
                      </>
                    ) : (
                      <>
                        <dt>Unexplained</dt>
                        <dd className="ft-num" data-testid={`unexplained-${a.accountId}`}>
                          {signed(a.unexplainedCents)}
                        </dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {eq.value && eq.value.accountIds.length > 0 && (
        <section className="tx-check__item" aria-label="Across everything" data-testid="net-worth-equation">
          <div className="tx-check__title">
            <strong>Across everything</strong>
            {eq.value.leftoverCents === 0 ? (
              <StatusLabel status="on-track">Adds up</StatusLabel>
            ) : (
              <StatusLabel status="warning">Leftover {signed(eq.value.leftoverCents)}</StatusLabel>
            )}
          </div>
          <dl className="tx-check__sum">
            <dt>Income</dt>
            <dd>
              <DrillAmount label="Income" cents={eq.value.incomeCents} onClick={eq.drill("income")} prefix="+" />
            </dd>
            <dt>Spending</dt>
            <dd>
              <DrillAmount label="Spending" cents={eq.value.spendingCents} onClick={eq.drill("spending")} prefix="−" />
            </dd>
            <dt>Poker net</dt>
            <dd>
              <DrillAmount label="Poker net" cents={eq.value.pokerNetCents} onClick={eq.drill("poker")} signedValue />
            </dd>
            <dt>Transfers to or from accounts that aren't linked</dt>
            <dd>
              <DrillAmount label="Transfers net" cents={eq.value.transfersNetCents} onClick={eq.drill("transfers")} signedValue />
            </dd>
            <dt>Investment gains and losses</dt>
            <dd className="ft-num">{signed(eq.value.investmentChangeCents)}</dd>
            <dt>Change in net worth</dt>
            <dd className="ft-num">{signed(eq.value.changeCents)}</dd>
            <dt>Leftover</dt>
            <dd className="ft-num" data-testid="leftover">
              {signed(eq.value.leftoverCents)}
            </dd>
          </dl>
          {eq.value.missingSnapshotAccountIds.length > 0 && (
            <p className="tx-muted tx-small">Not included (no balances for this period): {eq.value.missingSnapshotAccountIds.map(nameOf).join(", ")}.</p>
          )}
        </section>
      )}
    </div>
  );
}

function rank(a: AccountRec): number {
  return a.status === "unexplained" ? 0 : a.status === "ok" ? 1 : 2;
}

function DrillAmount({ label, cents, onClick, prefix, signedValue }: { label: string; cents: number; onClick?: () => void; prefix?: string; signedValue?: boolean }) {
  const text = signedValue ? signed(cents) : `${prefix ?? ""}${money(cents)}`;
  if (!onClick) return <span className="ft-num">{text}</span>;
  return (
    <button type="button" className="tx-inline-drill ft-num" onClick={onClick} aria-label={`${label}: ${money(cents)}. Show transactions`}>
      {text}
    </button>
  );
}
