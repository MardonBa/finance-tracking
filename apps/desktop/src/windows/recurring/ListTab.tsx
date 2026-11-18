/**
 * What they are (§9): every recurring charge and income with name, amount,
 * how often, next date and account. Estimates are marked; price changes and
 * new charges are noted quietly (no alarms). Add / edit / remove go through
 * registry actions with a preview.
 */
import { useState } from "react";
import { openDrillDown } from "../../data/drilldown.ts";
import { Button, Card, EmptyState, Select, Tooltip } from "../../ui/components.tsx";
import { FREQUENCY_LABELS, longDate, money, shortDate } from "../shared/format.ts";
import { ReviewAndConfirm } from "../shared/ReviewAndConfirm.tsx";
import { RecurringEditor } from "./RecurringEditor.tsx";
import type { AccountRow, CardPayment, ListItem, ListValue } from "./types.ts";

type Editing = { mode: "add" } | { mode: "edit"; item: ListItem } | null;

function estimateTip(i: ListItem): string {
  if (!i.estimateBasis) return "Estimated from recent amounts";
  return `Estimate: average of the last ${i.estimateBasis.amountsCents.length} amounts (${i.estimateBasis.amountsCents.map((c) => money(c)).join(", ")})`;
}

function ItemRow({ i, figures, onEdit, onRemove }: { i: ListItem; figures: Record<string, unknown>; onEdit: () => void; onRemove: () => void }) {
  const fig = `occurrences.${i.id}`;
  const hasFig = fig in figures;
  return (
    <tr>
      <td>
        <div>
          {hasFig ? (
            <button
              type="button"
              className="rti-link"
              title="Show past payments"
              onClick={() => openDrillDown({ query: "recurring.list", params: {}, figureId: fig, label: `Past ${i.name} payments` })}
            >
              {i.name}
            </button>
          ) : (
            i.name
          )}{" "}
          {i.isEstimate && (
            <Tooltip label={estimateTip(i)}>
              <span className="rti-badge rti-badge--estimate" tabIndex={0}>
                Estimate
              </span>
            </Tooltip>
          )}
          {i.isNew && <span className="rti-badge">New</span>}
          {i.source === "manual" && <span className="rti-badge">Added by you</span>}
          {i.editedFields.length > 0 && <span className="rti-badge">Edited</span>}
        </div>
        {i.priceChange && (
          <p className="rti-note">
            Was {money(i.priceChange.fromCents)}, now {money(i.priceChange.toCents)}
            {i.priceChange.changedOn ? ` since ${shortDate(i.priceChange.changedOn)}` : ""}
          </p>
        )}
      </td>
      <td className="is-num rti-num">
        {i.isEstimate ? "≈ " : ""}
        {money(i.amountCents)}
      </td>
      <td>{FREQUENCY_LABELS[i.frequency] ?? i.frequency}</td>
      <td>{i.nextDate ? shortDate(i.nextDate) : "–"}</td>
      <td>{i.accountName}</td>
      <td>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" aria-label={`Edit ${i.name}`} onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${i.name}`} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </td>
    </tr>
  );
}

function Section({ title, items, figures, setEditing, setRemoving }: {
  title: string;
  items: ListItem[];
  figures: Record<string, unknown>;
  setEditing: (e: Editing) => void;
  setRemoving: (i: ListItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Card title={title} padding="md">
      <table className="rti-table" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" className="is-num">
              Amount
            </th>
            <th scope="col">How often</th>
            <th scope="col">Next</th>
            <th scope="col">Account</th>
            <th scope="col">
              <span className="ui-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <ItemRow key={i.id} i={i} figures={figures} onEdit={() => setEditing({ mode: "edit", item: i })} onRemove={() => setRemoving(i)} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CardPayingAccounts({ accounts, cardPayments }: { accounts: readonly AccountRow[]; cardPayments: readonly CardPayment[] }) {
  const cards = accounts.filter((a) => a.kind === "credit" && !a.hidden);
  const payers = accounts.filter((a) => !a.isDebt && !a.hidden && (a.kind === "checking" || a.kind === "savings" || a.kind === "cash"));
  const [choice, setChoice] = useState<Record<string, string>>({});
  const clear = (id: string) =>
    setChoice((s) => {
      const { [id]: _drop, ...rest } = s;
      return rest;
    });
  if (cards.length === 0) return null;
  return (
    <Card title="Credit card statements">
      <p className="rti-note">Choose the account each card is paid from, so its statement shows in that account's upcoming view.</p>
      <div className="rti-stack" style={{ marginTop: "var(--space-3)" }}>
        {cards.map((c) => {
          const due = cardPayments.find((p) => p.cardAccountId === c.id);
          // TODO(revisit): no query exposes a card's paying account when no statement is due, so it shows "Not set" then (the preview shows the real "before").
          const current = choice[c.id] ?? due?.payingAccountId ?? "";
          return (
            <div key={c.id} className="rti-stack">
              <div className="rti-row">
                <Select label={`${c.name} is paid from`} value={current} onChange={(e) => setChoice((s) => ({ ...s, [c.id]: e.target.value }))}>
                  <option value="">Not set</option>
                  {payers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {due && (
                  <p className="rti-note">
                    Statement {money(due.statementBalanceCents)} due {longDate(due.dueDate)}
                    {due.paidCents > 0 ? `, ${money(due.paidCents)} already paid` : ""}.
                  </p>
                )}
              </div>
              {choice[c.id] !== undefined && choice[c.id] !== (due?.payingAccountId ?? "") && (
                <ReviewAndConfirm
                  action="recurring.setCardPayingAccount"
                  input={{ cardAccountId: c.id, payingAccountId: choice[c.id] || null }}
                  confirmLabel="Save"
                  onDone={() => clear(c.id)}
                  onCancel={() => clear(c.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export interface ListTabProps {
  value: ListValue;
  figures: Record<string, unknown>;
  accounts: readonly AccountRow[];
  cardPayments: readonly CardPayment[];
  editing: Editing;
  setEditing: (e: Editing) => void;
}

export function ListTab({ value, figures, accounts, cardPayments, editing, setEditing }: ListTabProps) {
  const [removing, setRemoving] = useState<ListItem | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const charges = value.items.filter((i) => i.direction === "outflow");
  const income = value.items.filter((i) => i.direction === "inflow");

  return (
    <div className="rti-stack">
      <div className="rti-toolbar">
        <p className="rti-note" style={{ flex: 1 }}>
          {value.newCharges.length > 0 && <>New: {value.newCharges.map((n) => n.name).join(", ")}. </>}
          {value.priceChanges.length > 0 && <>Price changes: {value.priceChanges.map((p) => p.priceChange!.message).join(" ")}</>}
        </p>
        <Button icon="plus" size="sm" onClick={() => setEditing({ mode: "add" })}>
          Add recurring item
        </Button>
      </div>

      {editing && (
        <RecurringEditor key={editing.mode === "edit" ? editing.item.id : "add"} item={editing.mode === "edit" ? editing.item : undefined} accounts={accounts} onClose={() => setEditing(null)} />
      )}

      {removing && (
        <Card title={`Remove ${removing.name}?`}>
          <p className="rti-note">
            {removing.source === "manual"
              ? "It will be deleted from the list and projections."
              : "It will be hidden from the list and projections, and stay hidden after the next sync. You can restore it below."}
          </p>
          <ReviewAndConfirm
            action="recurring.remove"
            input={{ recurringItemId: removing.id, removed: true }}
            confirmLabel="Remove"
            onDone={() => setRemoving(null)}
            onCancel={() => setRemoving(null)}
          />
        </Card>
      )}

      {value.items.length === 0 ? (
        <EmptyState
          icon="recurring"
          title="No recurring charges yet"
          description="Subscriptions and bills are detected after a few months of transactions. You can add one yourself now."
          action={{ label: "Add recurring item", icon: "plus", onClick: () => setEditing({ mode: "add" }) }}
        />
      ) : (
        <>
          <Section title="Charges and bills" items={charges} figures={figures} setEditing={setEditing} setRemoving={setRemoving} />
          <Section title="Income" items={income} figures={figures} setEditing={setEditing} setRemoving={setRemoving} />
        </>
      )}

      <CardPayingAccounts accounts={accounts} cardPayments={cardPayments} />

      {(value.removed.length > 0 || value.inactive.length > 0) && (
        <details className="rti-details">
          <summary>
            Removed or stopped ({value.removed.length + value.inactive.length})
          </summary>
          <ul>
            {value.removed.map((r) => (
              <li key={r.id}>
                {r.name} · removed by you{" "}
                {restoring === r.id ? null : (
                  <button type="button" className="rti-link" onClick={() => setRestoring(r.id)}>
                    Restore
                  </button>
                )}
                {restoring === r.id && (
                  <ReviewAndConfirm
                    action="recurring.remove"
                    input={{ recurringItemId: r.id, removed: false }}
                    confirmLabel="Restore"
                    onDone={() => setRestoring(null)}
                    onCancel={() => setRestoring(null)}
                  />
                )}
              </li>
            ))}
            {value.inactive.map((r) => (
              <li key={r.id}>{r.name} · stopped (no recent payments)</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export type { Editing };
