/**
 * One transaction row (§7 "each row"): date, merchant, category, amount,
 * account and markers for pending / transfer / split / refund / Poker / note.
 * Clicking the row opens its fixes; clicking the merchant opens the merchant view.
 */
import type { ReactNode } from "react";
import type { Flows } from "@ft/core";
import { openMerchant } from "../../data/drilldown.ts";
import { colorOfCategory } from "../../data/useCategoryColors.ts";
import { dayLabel } from "../../data/dates.ts";
import { Tooltip } from "../../ui/components.tsx";
import { signed } from "./format.ts";
import { RowFixes } from "./RowFixes.tsx";

export type Row = Flows.TransactionRow;

const MARKERS: { key: keyof Row["markers"]; text: string; tip: string }[] = [
  { key: "pending", text: "Pending", tip: "Not cleared yet, so it doesn't count in totals" },
  { key: "transfer", text: "Transfer", tip: "Money moved between accounts: not spending or income" },
  { key: "split", text: "Split", tip: "Split into parts with their own categories" },
  { key: "refund", text: "Refund", tip: "A refund linked to its original purchase" },
  { key: "poker", text: "Poker", tip: "Poker banking: kept out of spending and income; only the net counts" },
  { key: "note", text: "Note", tip: "Has a note" },
];

export function Markers({ row }: { row: Row }) {
  const on = MARKERS.filter((m) => row.markers[m.key]);
  if (on.length === 0) return null;
  return (
    <span className="tx-markers">
      {on.map((m) => (
        <Tooltip key={m.key} label={m.tip}>
          <span className={`tx-marker tx-marker--${m.key}`} tabIndex={0}>
            {m.text}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

export function CategoryChip({ category, label }: { category: string; label: string }) {
  return (
    <span className="tx-cat">
      <span className="tx-cat__dot" style={{ background: colorOfCategory(category) }} aria-hidden="true" />
      <span className="tx-cat__text">{label}</span>
    </span>
  );
}

export interface TxRowProps {
  row: Row;
  expanded: boolean;
  onToggle: () => void;
  /** Shown in the amount column instead of the row amount (e.g. what this row counts toward a figure). */
  counted?: ReactNode;
  /** Extra lines under the row (split parts, refunds). */
  children?: ReactNode;
  currentYear?: string;
}

export function TxRow({ row, expanded, onToggle, counted, children, currentYear }: TxRowProps) {
  const merchant = row.transferLabel ?? row.merchantName;
  return (
    <li className={`tx-row${expanded ? " is-expanded" : ""}${row.markers.pending ? " is-pending" : ""}`} data-testid={`row-${row.transactionId}`}>
      <div className="tx-row__main">
        <button
          type="button"
          className="tx-row__toggle"
          aria-expanded={expanded}
          aria-label={`${dayLabel(row.date)} ${merchant} ${signed(row.amountCents)}. ${expanded ? "Hide" : "Show"} fixes`}
          onClick={onToggle}
        />
        <span className="tx-row__date">{dayLabel(row.date, currentYear)}</span>
        <span className="tx-row__who">
          <button
            type="button"
            className="tx-link"
            onClick={() => openMerchant({ merchantKey: row.merchantKey, label: row.merchantName })}
            title={`All transactions from ${row.merchantName}`}
          >
            {merchant}
          </button>
          <Markers row={row} />
          {row.note && <span className="tx-row__note">“{row.note}”</span>}
        </span>
        <span className="tx-row__cat">
          {row.parts.length > 0 ? (
            <span className="tx-muted">{row.parts.length} parts</span>
          ) : (
            <CategoryChip category={row.category} label={row.categoryLabel} />
          )}
        </span>
        <span className="tx-row__account">{row.accountName}</span>
        <span className={`tx-row__amount${row.amountCents > 0 ? " is-in" : ""}`}>{counted ?? signed(row.amountCents)}</span>
      </div>
      {children}
      {expanded && <RowFixes row={row} />}
    </li>
  );
}
