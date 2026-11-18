/**
 * "Needs a look" (§6): only what the app is unsure about, each with the
 * reason and one-click fixes (run at once, with before → after and Undo).
 */
import { useState } from "react";
import type { Flows } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { todayIso } from "../../data/dates.ts";
import { Button, EmptyState, Select } from "../../ui/components.tsx";
import { OneClickResult, useOneClick } from "./ActionFlow.tsx";
import { CategoryOptions, type FilterOptions } from "./RowFixes.tsx";
import { TxRow, type Row } from "./TxRow.tsx";

type Item = Flows.NeedsALookItem & { rows: Row[] };

export interface NeedsALookValue {
  from: string;
  to: string;
  count: number;
  items: Item[];
}

const TITLES: Record<Flows.NeedsALookKind, string> = {
  unmatched_transfer: "Transfer with no other half",
  transfer_match_review: "Transfer match to check",
  uncategorised: "No category",
  possible_duplicate: "Possible duplicate",
  large_unusual: "Large, unusual amount",
  split_mismatch: "Split doesn't add up",
};

export function NeedsALookView() {
  const q = useQuery<NeedsALookValue>("flows.needsALook", {});
  const oc = useOneClick();
  const v = q.data?.value;
  if (q.error && !v) return <EmptyState icon="warning" title="Couldn't load Needs a look" description={q.error.message} />;
  if (!v) return <p className="tx-muted tx-pad">Loading…</p>;
  return (
    <div className="tx-view">
      <OneClickResult oc={oc} />
      {v.items.length === 0 ? (
        <EmptyState icon="check" title="Nothing needs a look" description="Everything from the last 90 days looks right. New doubts show up here." />
      ) : (
        <ul className="tx-needs" aria-label="Needs a look">
          {v.items.map((it) => (
            <NeedsItem key={it.id} item={it} run={(n, i) => void oc.run(n, i)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NeedsItem({ item, run }: { item: Item; run: (name: string, input: unknown) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [cat, setCat] = useState("");
  const opts = useQuery<FilterOptions>("transactions.filterOptions", {});
  const ids = item.transactionIds;
  const first = item.rows[0];
  const confirm = (label: string) => (
    <Button size="sm" onClick={() => run("flows.confirm", { transactionIds: ids, confirmed: true })}>
      {label}
    </Button>
  );
  const year = todayIso().slice(0, 4);
  return (
    <li className="tx-needs__item">
      <div className="tx-needs__head">
        <strong>{TITLES[item.kind]}</strong>
        <span className="tx-muted">{item.reason}</span>
      </div>
      <ul className="tx-list">
        {item.rows.map((r) => (
          <TxRow key={r.transactionId} row={r} currentYear={year} expanded={open === r.transactionId} onToggle={() => setOpen(open === r.transactionId ? null : r.transactionId)} />
        ))}
      </ul>
      <div className="tx-needs__fixes">
        {item.kind === "unmatched_transfer" && first && (
          <>
            {confirm("Yes, it's a transfer")}
            <Button size="sm" onClick={() => run("flows.unmarkTransfer", { transactionId: first.transactionId, countAs: first.amountCents > 0 ? "income" : "spending" })}>
              It's {first.amountCents > 0 ? "income" : "spending"}
            </Button>
            <Button size="sm" onClick={() => run("flows.markPoker", { transactionId: first.transactionId, poker: true })}>
              It's Poker
            </Button>
          </>
        )}
        {item.kind === "transfer_match_review" && first && (
          <>
            {confirm("Match is right")}
            <Button size="sm" onClick={() => run("flows.unmarkTransfer", { transactionId: first.transactionId, countAs: first.amountCents > 0 ? "income" : "spending" })}>
              Not a transfer
            </Button>
          </>
        )}
        {item.kind === "uncategorised" && first && (
          <>
            <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Choose…</option>
              <CategoryOptions options={opts.data?.value.categories ?? []} />
            </Select>
            <Button size="sm" variant="primary" disabled={!cat} onClick={() => run("transactions.recategorise", { transactionId: first.transactionId, category: cat, alwaysForMerchant: false })}>
              Set category
            </Button>
            <Button size="sm" disabled={!cat} onClick={() => run("transactions.recategorise", { transactionId: first.transactionId, category: cat, alwaysForMerchant: true })}>
              Always for {first.merchantName}
            </Button>
          </>
        )}
        {item.kind === "possible_duplicate" && confirm("Not a duplicate")}
        {item.kind === "large_unusual" && confirm("Looks right")}
        {item.kind === "split_mismatch" && first && (
          <Button size="sm" onClick={() => run("transactions.unsplit", { transactionId: first.transactionId })}>
            Remove the split
          </Button>
        )}
      </div>
    </li>
  );
}
