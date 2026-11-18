/**
 * Manual accounts (§3 "Manual accounts (cash)"): add one with a starting
 * balance, and add / edit / delete its transactions (amount, date,
 * description, category, note). The balance always comes from the
 * transactions (core derives it in each action), so it updates on save.
 */
import { useState, type FormEvent } from "react";
import { Flows, Money, toCents, type AccountKind } from "@ft/core";
import { useActions, useQuery } from "../data/hooks.ts";
import { Button, IconButton, Input, SegmentedControl, Select } from "../ui/components.tsx";
import { errorMessage } from "../connections/api.ts";
import { KIND_LABELS } from "./AccountEditor.tsx";

const MANUAL_KINDS: AccountKind[] = ["cash", "checking", "savings", "other"];

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "12.50" / "$1,200" -> cents; null when it isn't an amount. */
export function parseDollars(text: string): number | null {
  const t = text.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return toCents(t);
}

export function ManualAccountForm({ onCreated, onCancel }: { onCreated: (name: string) => void; onCancel?: () => void }) {
  const actions = useActions();
  const [name, setName] = useState("Cash");
  const [kind, setKind] = useState<AccountKind>("cash");
  const [balance, setBalance] = useState("0");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseDollars(balance);
    if (!name.trim()) return setError("Give the account a name.");
    if (cents === null) return setError("Enter the starting balance as a number, e.g. 40 or 40.00.");
    setBusy(true);
    setError(undefined);
    try {
      await actions.run("accounts.addManualAccount", { name: name.trim(), kind, startingBalanceCents: cents, startingDate: date });
      onCreated(name.trim());
    } catch (err) {
      setError(errorMessage(err, "Couldn't add the account."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ft-stack" onSubmit={submit} aria-label="Add a manual account">
      <p className="ft-muted">For money no bank reports, like cash in your wallet. You enter its transactions yourself; it's labelled “Manual”.</p>
      <div className="ft-form-grid">
        <Input label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
          {MANUAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Input label="Starting balance ($)" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        <Input label="As of" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </div>
      {error && (
        <p className="ft-note ft-note--danger" role="alert">
          {error}
        </p>
      )}
      <div className="ft-row ft-row--end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" icon="plus" disabled={busy}>
          {busy ? "Adding…" : "Add manual account"}
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ transactions

interface Row {
  transactionId: string;
  date: string;
  merchantName: string | null;
  rawDescription: string;
  category: string | null;
  categoryLabel: string | null;
  amountCents: number;
  note: string | null;
}

interface Draft {
  id: string | null;
  direction: "out" | "in";
  amount: string;
  date: string;
  description: string;
  category: string;
  note: string;
}

const emptyDraft = (): Draft => ({ id: null, direction: "out", amount: "", date: todayIso(), description: "", category: "", note: "" });

const OPENING_SUFFIX = "__opening";

export function ManualTransactions({ accountId }: { accountId: string }) {
  const actions = useActions();
  const list = useQuery<{ rows: Row[]; count: number }>("transactions.list", { accountIds: [accountId], measure: "amount", includePending: true, limit: 200 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const rows = (list.data?.value.rows ?? []).filter((r) => !r.transactionId.endsWith(OPENING_SUFFIX));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const abs = parseDollars(draft.amount);
    if (abs === null || abs === 0) return setError("Enter an amount, e.g. 12.50.");
    if (!draft.description.trim()) return setError("Add a short description.");
    const amountCents = draft.direction === "out" ? -Math.abs(abs) : Math.abs(abs);
    const category = draft.category || null;
    const note = draft.note.trim() || null;
    setBusy(true);
    setError(undefined);
    try {
      if (draft.id === null) {
        await actions.run("accounts.addManualTransaction", { accountId, amountCents, date: draft.date, description: draft.description.trim(), category, note });
      } else {
        const before = rows.find((r) => r.transactionId === draft.id);
        await actions.run("accounts.editManualTransaction", { transactionId: draft.id, amountCents, date: draft.date, description: draft.description.trim() });
        if ((before?.category ?? null) !== category) await actions.run("transactions.recategorise", { transactionId: draft.id, category, alwaysForMerchant: false });
        if ((before?.note ?? null) !== note) await actions.run("transactions.setNote", { transactionId: draft.id, note });
      }
      setDraft(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the transaction."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await actions.run("accounts.deleteManualTransaction", { transactionId: id });
      if (draft?.id === id) setDraft(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the transaction."));
    } finally {
      setBusy(false);
    }
  };

  const edit = (r: Row) =>
    setDraft({
      id: r.transactionId,
      direction: r.amountCents < 0 ? "out" : "in",
      amount: (Math.abs(r.amountCents) / 100).toFixed(2),
      date: r.date,
      description: r.rawDescription,
      category: r.category && (Flows.PLAID_PRIMARY_CATEGORIES as readonly string[]).includes(r.category) ? r.category : "",
      note: r.note ?? "",
    });

  return (
    <section className="ft-stack" aria-label="Manual transactions">
      <div className="ft-row ft-row--between">
        <h3 className="ft-section-title">Transactions</h3>
        {!draft && (
          <Button size="sm" icon="plus" onClick={() => setDraft(emptyDraft())}>
            Add transaction
          </Button>
        )}
      </div>
      {draft && (
        <form className="ft-stack ft-inline-form" onSubmit={save} aria-label={draft.id ? "Edit transaction" : "Add transaction"}>
          <SegmentedControl
            label="Direction"
            size="sm"
            value={draft.direction}
            onChange={(v) => setDraft({ ...draft, direction: v })}
            options={[
              { value: "out", label: "Money out" },
              { value: "in", label: "Money in" },
            ]}
          />
          <div className="ft-form-grid">
            <Input label="Amount ($)" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required />
            <Input label="Date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required />
            <Input label="Description" value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} required />
            <Select label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              <option value="">No category</option>
              {Flows.PLAID_PRIMARY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {Flows.categoryLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          <Input label="Note" value={draft.note} maxLength={2000} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <div className="ft-row ft-row--end">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : draft.id ? "Save changes" : "Add"}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="ft-note ft-note--danger" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 && !list.loading ? (
        <p className="ft-muted">No transactions yet · Add one when you spend or receive cash.</p>
      ) : (
        <ul className="ft-list ft-tx-list">
          {rows.map((r) => (
            <li key={r.transactionId} className="ft-tx-row">
              <span className="ft-tx-row__date">{r.date}</span>
              <span className="ft-tx-row__desc">
                {r.merchantName ?? r.rawDescription}
                <span className="ft-small ft-muted">
                  {r.categoryLabel ?? "No category"}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              <span className="ft-tx-row__amount ft-num">{Money.format(r.amountCents, { showPlus: true })}</span>
              <IconButton icon="pencil" label={`Edit ${r.rawDescription}`} size="sm" onClick={() => edit(r)} />
              <IconButton icon="trash" label={`Delete ${r.rawDescription}`} size="sm" onClick={() => void remove(r.transactionId)} disabled={busy} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
