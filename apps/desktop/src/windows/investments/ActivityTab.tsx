/**
 * Investment activity (§17): buys, sells, dividends, fees and transfers,
 * with notes (investments.setNote, previewed first). Dividends count as
 * income; buys and sells as neither (§6).
 */
import { useState } from "react";
import type { Investments } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Button, Input, StatNumber } from "../../ui/components.tsx";
import { longDate, money } from "../shared/format.ts";
import { ReviewAndConfirm } from "../shared/ReviewAndConfirm.tsx";
import { ConnectEmptyState } from "../shared/ConnectEmptyState.tsx";

type ActivityValue = { rows: Investments.ActivityRow[]; dividendIncomeCents: number; feesCents: number; tradeFeesCents: number };

const KIND_LABELS: Record<Investments.ActivityKind, string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  interest: "Interest",
  fee: "Fee",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  other: "Other",
};

const COUNTS_AS: Record<Investments.CountsAs, string> = { income: "Income", neither: "Not spending or income", fee: "Fee" };

function NoteCell({ row }: { row: Investments.ActivityRow }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.note ?? "");
  if (!editing) {
    return (
      <div>
        {row.note && <span>{row.note} </span>}
        <button type="button" className="rti-link" onClick={() => (setText(row.note ?? ""), setEditing(true))} aria-label={`${row.note ? "Edit" : "Add"} note on ${row.description}`}>
          {row.note ? "Edit" : "Add note"}
        </button>
      </div>
    );
  }
  const next = text.trim() === "" ? null : text;
  return (
    <div className="rti-stack" style={{ gap: "var(--space-2)", minWidth: 220 }}>
      <Input label="Note" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      <ReviewAndConfirm
        action="investments.setNote"
        input={next === row.note ? null : { investmentTransactionId: row.id, note: next }}
        invalidReason="Change the note to save it."
        reviewLabel="Save note…"
        confirmLabel="Save"
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    </div>
  );
}

export function ActivityTab() {
  const q = useQuery<ActivityValue>("investments.activity", {});
  const [shown, setShown] = useState(50);
  if (q.error && !q.data) return <p className="rti-error">Couldn't load activity: {q.error.message}</p>;
  if (!q.data) return <p className="rti-note">Loading…</p>;
  const v = q.data.value;
  if (v.rows.length === 0)
    return <ConnectEmptyState icon="investments" title="No investment activity yet" description="Buys, sells, dividends and fees from your investment accounts appear here after the next sync." />;
  return (
    <div className="rti-stack">
      <div className="rti-row">
        <StatNumber label="Dividends and interest (income)" value={money(v.dividendIncomeCents)} />
        <StatNumber label="Fees" value={money(Math.abs(v.feesCents) + Math.abs(v.tradeFeesCents))} detail="account fees plus fees on trades" />
      </div>
      <table className="rti-table" aria-label="Investment activity">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">What</th>
            <th scope="col" className="is-num">Amount</th>
            <th scope="col">Counts as</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {v.rows.slice(0, shown).map((r) => (
            <tr key={r.id}>
              <td>{longDate(r.date)}</td>
              <td>
                <span className="rti-badge">{KIND_LABELS[r.kind]}</span>
              </td>
              <td>
                {r.securityName ? `${r.securityName}${r.ticker ? ` (${r.ticker})` : ""}` : r.description}
                {r.quantity !== null && r.quantity !== 0 && <span className="rti-note"> · {Math.abs(r.quantity).toLocaleString("en-US", { maximumFractionDigits: 4 })} shares</span>}
              </td>
              <td className="is-num rti-num">{money(r.amountCents, { showPlus: true })}</td>
              <td className="rti-note">{COUNTS_AS[r.countsAs]}</td>
              <td>
                <NoteCell row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {v.rows.length > shown && (
        <div>
          <Button size="sm" onClick={() => setShown((n) => n + 50)}>
            Show more ({v.rows.length - shown} left)
          </Button>
        </div>
      )}
    </div>
  );
}
