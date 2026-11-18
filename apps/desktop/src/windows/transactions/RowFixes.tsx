/**
 * Fixes from the row (§6, §7): recategorise (+ always for this merchant),
 * split, mark / undo a transfer, link a refund, mark Poker (+ rule),
 * necessary override, tags and the note. Each goes through a previewed action.
 */
import { useState } from "react";
import { toCents } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Button, Input, SegmentedControl, Select, Toggle } from "../../ui/components.tsx";
import { ActionFlowPanel, useActionFlow, type ActionFlow } from "./ActionFlow.tsx";
import { dayLabel } from "../../data/dates.ts";
import { money } from "./format.ts";
import type { Row } from "./TxRow.tsx";

export interface FilterOptions {
  categories: { category: string; label: string; primary: string; isPrimary: boolean }[];
  tags: { id: string; name: string }[];
}

type Fix = "category" | "split" | "transfer" | "refund" | "poker" | "necessary" | "tags" | "note";

export function CategoryOptions({ options }: { options: FilterOptions["categories"] }) {
  return (
    <>
      {options.map((o) => (
        <option key={o.category} value={o.category}>
          {o.isPrimary ? o.label : `  · ${o.label}`}
        </option>
      ))}
    </>
  );
}

export function RowFixes({ row }: { row: Row }) {
  const flow = useActionFlow();
  const [fix, setFix] = useState<Fix>(row.markers.note ? "note" : "category");
  const opts = useQuery<FilterOptions>("transactions.filterOptions", {});
  const choose = (f: Fix) => {
    setFix(f);
    flow.cancel();
  };
  const fixes: { value: Fix; label: string }[] = [
    { value: "category", label: "Category" },
    { value: "split", label: "Split" },
    { value: "transfer", label: "Transfer" },
    ...(row.amountCents > 0 || row.markers.refund ? [{ value: "refund" as Fix, label: "Refund" }] : []),
    { value: "poker", label: "Poker" },
    { value: "necessary", label: "Necessary?" },
    { value: "tags", label: "Tags" },
    { value: "note", label: "Note" },
  ];
  const options = opts.data?.value;
  return (
    <div className="tx-fixes" role="group" aria-label={`Fix ${row.merchantName}`}>
      <SegmentedControl size="sm" label="What to fix" options={fixes} value={fix} onChange={choose} />
      <div className="tx-fixes__body">
        {fix === "category" && options && <CategoryFix row={row} options={options} flow={flow} />}
        {fix === "split" && options && <SplitFix row={row} options={options} flow={flow} />}
        {fix === "transfer" && <TransferFix row={row} flow={flow} />}
        {fix === "refund" && <RefundFix row={row} flow={flow} />}
        {fix === "poker" && <PokerFix row={row} flow={flow} />}
        {fix === "necessary" && <NecessaryFix row={row} flow={flow} />}
        {fix === "tags" && options && <TagsFix row={row} options={options} flow={flow} />}
        {fix === "note" && <NoteFix row={row} flow={flow} />}
        {!options && (fix === "category" || fix === "split" || fix === "tags") && <p className="tx-muted">Loading…</p>}
      </div>
      <ActionFlowPanel flow={flow} />
    </div>
  );
}

interface FixProps {
  row: Row;
  flow: ActionFlow;
}

function CategoryFix({ row, options, flow }: FixProps & { options: FilterOptions }) {
  const [cat, setCat] = useState(row.category);
  const [always, setAlways] = useState(false);
  return (
    <div className="tx-fix">
      <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
        {!options.categories.some((c) => c.category === row.category) && <option value={row.category}>{row.categoryLabel}</option>}
        <CategoryOptions options={options.categories} />
      </Select>
      <Toggle checked={always} onChange={setAlways} label={`Always do this for ${row.merchantName}`} />
      <Button
        size="sm"
        variant="primary"
        disabled={cat === row.category && !always}
        onClick={() => void flow.propose({ name: "transactions.recategorise", input: { transactionId: row.transactionId, category: cat, alwaysForMerchant: always } })}
      >
        Preview change
      </Button>
    </div>
  );
}

interface PartDraft {
  amount: string;
  category: string;
}

function SplitFix({ row, options, flow }: FixProps & { options: FilterOptions }) {
  const sign = row.amountCents < 0 ? -1 : 1;
  const abs = Math.abs(row.amountCents);
  const half = Math.floor(abs / 2);
  const [parts, setParts] = useState<PartDraft[]>([
    { amount: ((abs - half) / 100).toFixed(2), category: row.category },
    { amount: (half / 100).toFixed(2), category: row.category },
  ]);
  if (row.markers.split) {
    return (
      <div className="tx-fix">
        <p className="tx-muted">
          Split into {row.parts.map((p) => `${p.categoryLabel} ${money(Math.abs(p.amountCents))}`).join(", ")}.
        </p>
        <Button size="sm" onClick={() => void flow.propose({ name: "transactions.unsplit", input: { transactionId: row.transactionId } })}>
          Remove the split
        </Button>
      </div>
    );
  }
  const cents = parts.map((p) => {
    try {
      return Math.abs(toCents(p.amount || "0"));
    } catch {
      return NaN;
    }
  });
  const valid = cents.every((c) => Number.isFinite(c) && c > 0);
  const left = abs - cents.reduce((s, c) => s + (Number.isFinite(c) ? c : 0), 0);
  const set = (i: number, patch: Partial<PartDraft>) => setParts(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="tx-fix tx-fix--split">
      {parts.map((p, i) => (
        <div key={i} className="tx-split-part">
          <Input label={`Part ${i + 1} amount`} inputMode="decimal" value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          <Select label={`Part ${i + 1} category`} value={p.category} onChange={(e) => set(i, { category: e.target.value })}>
            {!options.categories.some((c) => c.category === p.category) && <option value={p.category}>{row.categoryLabel}</option>}
            <CategoryOptions options={options.categories} />
          </Select>
          {parts.length > 2 && (
            <Button size="sm" variant="ghost" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
              Remove
            </Button>
          )}
        </div>
      ))}
      <div className="tx-fix">
        <Button size="sm" variant="ghost" icon="plus" disabled={parts.length >= 20} onClick={() => setParts([...parts, { amount: "", category: row.category }])}>
          Add a part
        </Button>
        <span className={left === 0 ? "tx-muted" : "tx-warn"} role="status">
          {left === 0 ? `Parts add up to ${money(abs)}` : left > 0 ? `${money(left)} left to assign` : `${money(-left)} too much`}
        </span>
        <Button
          size="sm"
          variant="primary"
          disabled={!valid || left !== 0}
          onClick={() =>
            void flow.propose({
              name: "transactions.split",
              input: { transactionId: row.transactionId, parts: parts.map((p, i) => ({ amountCents: sign * cents[i]!, category: p.category })) },
            })
          }
        >
          Preview split
        </Button>
      </div>
    </div>
  );
}

function TransferFix({ row, flow }: FixProps) {
  const [always, setAlways] = useState(false);
  if (row.markers.transfer) {
    const countAs = row.amountCents > 0 ? "income" : "spending";
    return (
      <div className="tx-fix">
        <p className="tx-muted">{row.transferLabel ?? "Counted as a transfer (not spending or income)."}</p>
        <Button size="sm" onClick={() => void flow.propose({ name: "flows.unmarkTransfer", input: { transactionId: row.transactionId, countAs } })}>
          Not a transfer: count as {countAs}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void flow.propose({ name: "flows.confirm", input: { transactionIds: [row.transactionId], confirmed: true } })}>
          Yes, it's a transfer
        </Button>
      </div>
    );
  }
  return (
    <div className="tx-fix">
      <Toggle checked={always} onChange={setAlways} label={`Always treat ${row.merchantName} as a transfer`} />
      <Button
        size="sm"
        variant="primary"
        onClick={() =>
          void flow.propose({
            name: "flows.markTransfer",
            input: { transactionId: row.transactionId, ...(always ? { always: { kind: "merchant", thisAccountOnly: false } } : {}) },
          })
        }
      >
        Preview: mark as transfer
      </Button>
    </div>
  );
}

interface RefundSuggestion {
  refundTransactionId: string;
  purchaseTransactionId: string;
  refundCents: number;
  purchaseCents: number;
  daysApart: number;
  merchantName: string;
}

function RefundFix({ row, flow }: FixProps) {
  const sugg = useQuery<RefundSuggestion[]>("flows.refundSuggestions", {});
  if (row.markers.refund) {
    return (
      <div className="tx-fix">
        <p className="tx-muted">Linked to a purchase, so it counts in that purchase's month and category.</p>
        <Button size="sm" onClick={() => void flow.propose({ name: "flows.unlinkRefund", input: { refundTransactionId: row.transactionId } })}>
          Unlink the refund
        </Button>
      </div>
    );
  }
  const mine = (sugg.data?.value ?? []).filter((s) => s.refundTransactionId === row.transactionId);
  if (sugg.loading && !sugg.data) return <p className="tx-muted">Looking for the purchase…</p>;
  const link = (purchaseTransactionId: string) =>
    void flow.propose({ name: "flows.linkRefund", input: { refundTransactionId: row.transactionId, purchaseTransactionId } });
  return (
    <div className="tx-fix tx-fix--column">
      {mine.length === 0 ? (
        <p className="tx-muted">No purchase from {row.merchantName} of at least {money(row.amountCents)} in the 90 days before, so it counts in the month it arrived. You can link it to any purchase below.</p>
      ) : (
        <div className="tx-fix">
          {mine.map((s) => (
            <Button key={s.purchaseTransactionId} size="sm" onClick={() => link(s.purchaseTransactionId)}>
              Link to the {money(Math.abs(s.purchaseCents))} purchase {s.daysApart} days earlier
            </Button>
          ))}
        </div>
      )}
      <PurchasePicker refund={row} onPick={link} />
    </div>
  );
}

/**
 * Link a refund to any purchase by hand (§7 "link a refund"): search spending
 * up to the refund's date by merchant, description, note or amount. Only
 * purchases at least as big as the refund are offered, since a linked refund
 * can't take a purchase below zero (§6).
 */
function PurchasePicker({ refund, onPick }: { refund: Row; onPick: (purchaseTransactionId: string) => void }) {
  const [text, setText] = useState("");
  const q = useQuery<{ rows: Row[] }>("transactions.list", {
    buckets: ["spending"],
    to: refund.date,
    dateField: "date",
    text: text.trim() || undefined,
    measure: "amount",
    limit: 50,
  });
  const fits = (q.data?.value.rows ?? []).filter((r) => r.amountCents < 0 && -r.amountCents >= refund.amountCents && r.transactionId !== refund.transactionId).slice(0, 8);
  const year = refund.date.slice(0, 4);
  return (
    <div className="tx-fix tx-fix--column" role="group" aria-label="Find the purchase">
      <Input
        label="Find the purchase"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Merchant, description, note or amount"
        hint={`Purchases up to ${dayLabel(refund.date, year)} of at least ${money(refund.amountCents)}.`}
      />
      {q.loading && !q.data ? (
        <p className="tx-muted">Searching…</p>
      ) : fits.length === 0 ? (
        <p className="tx-muted">No purchase matches.</p>
      ) : (
        <ul className="tx-picker" aria-label="Matching purchases">
          {fits.map((r) => (
            <li key={r.transactionId}>
              <Button size="sm" variant="ghost" onClick={() => onPick(r.transactionId)}>
                Link to {r.merchantName} · {dayLabel(r.date, year)} · {money(Math.abs(r.amountCents))}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PokerFix({ row, flow }: FixProps) {
  const [always, setAlways] = useState(false);
  const poker = row.markers.poker;
  return (
    <div className="tx-fix">
      {!poker && <Toggle checked={always} onChange={setAlways} label={`Always Poker for ${row.merchantName}`} />}
      <Button
        size="sm"
        variant={poker ? "secondary" : "primary"}
        onClick={() =>
          void flow.propose({
            name: "flows.markPoker",
            input: { transactionId: row.transactionId, poker: !poker, ...(always && !poker ? { always: { kind: "merchant", thisAccountOnly: false } } : {}) },
          })
        }
      >
        {poker ? "Not Poker" : "Preview: mark as Poker"}
      </Button>
    </div>
  );
}

const SOURCE_TEXT: Record<string, string> = {
  transaction: "set on this transaction",
  rule: "from a rule",
  merchant: "from the merchant's label",
  category: "from the category's label",
};

function NecessaryFix({ row, flow }: FixProps) {
  type N = "necessary" | "not_necessary" | "not_set";
  const cur: N = row.necessity ?? "not_set";
  return (
    <div className="tx-fix">
      <SegmentedControl<N>
        size="sm"
        label="Necessary?"
        value={cur}
        options={[
          { value: "necessary", label: "Necessary" },
          { value: "not_necessary", label: "Not necessary" },
          { value: "not_set", label: "Not set" },
        ]}
        onChange={(v) => void flow.propose({ name: "transactions.setNecessity", input: { transactionId: row.transactionId, necessity: v === "not_set" ? null : v } })}
      />
      <span className="tx-muted">{row.necessitySource ? `Currently ${SOURCE_TEXT[row.necessitySource]}` : "Not labelled yet"}</span>
    </div>
  );
}

function TagsFix({ row, options, flow }: FixProps & { options: FilterOptions }) {
  const names = row.tagIds.map((id) => options.tags.find((t) => t.id === id)?.name ?? id);
  const [text, setText] = useState(names.join(", "));
  const tags = [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
  return (
    <div className="tx-fix">
      <Input label="Tags (comma separated)" placeholder="e.g. Lisbon trip" value={text} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" variant="primary" onClick={() => void flow.propose({ name: "transactions.setTags", input: { transactionId: row.transactionId, tags } })}>
        Preview tags
      </Button>
    </div>
  );
}

function NoteFix({ row, flow }: FixProps) {
  const [text, setText] = useState(row.note ?? "");
  return (
    <div className="tx-fix tx-fix--note">
      <label className="ui-field">
        <span className="ui-field__label">{row.transferCounterpartId ? "Note (one note for both sides of the transfer)" : "Note"}</span>
        <textarea className="ui-input tx-note-input" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="tx-fix">
        <Button
          size="sm"
          variant="primary"
          disabled={text.trim() === (row.note ?? "")}
          onClick={() => void flow.propose({ name: "transactions.setNote", input: { transactionId: row.transactionId, note: text.trim() || null } })}
        >
          {row.note ? "Preview edit" : "Preview note"}
        </Button>
        {row.note && (
          <Button size="sm" variant="ghost" onClick={() => void flow.propose({ name: "transactions.setNote", input: { transactionId: row.transactionId, note: null } })}>
            Remove note
          </Button>
        )}
      </div>
    </div>
  );
}
