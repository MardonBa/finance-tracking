/**
 * Add a recurring item Plaid missed, or correct one it got wrong (name,
 * amount, next date, account, how often). Goes through recurring.add /
 * recurring.edit with a preview first; the projections update afterwards.
 */
import { useMemo, useState } from "react";
import { Card, Input, Select } from "../../ui/components.tsx";
import { FREQUENCY_LABELS, dollarsText, parseDollars, todayIso } from "../shared/format.ts";
import { ReviewAndConfirm } from "../shared/ReviewAndConfirm.tsx";
import type { AccountRow, ListItem } from "./types.ts";

const FREQUENCIES = ["weekly", "biweekly", "semi_monthly", "monthly", "annually"] as const;

export interface RecurringEditorProps {
  /** The item to edit; absent = add a new one. */
  item?: ListItem;
  accounts: readonly AccountRow[];
  onClose: () => void;
}

export function RecurringEditor({ item, accounts, onClose }: RecurringEditorProps) {
  const payable = accounts.filter((a) => !a.hidden);
  const [name, setName] = useState(item?.name ?? "");
  const [amount, setAmount] = useState(item ? dollarsText(item.amountCents) : "");
  const [frequency, setFrequency] = useState<string>(item?.frequency ?? "monthly");
  const [nextDate, setNextDate] = useState(item?.nextDate ?? todayIso());
  const [accountId, setAccountId] = useState(item?.accountId ?? payable.find((a) => a.kind === "checking")?.id ?? payable[0]?.id ?? "");
  const [direction, setDirection] = useState<"outflow" | "inflow">(item?.direction ?? "outflow");

  const amountCents = parseDollars(amount);
  const { input, reason } = useMemo(() => {
    if (!name.trim()) return { input: null, reason: "Give it a name." };
    if (amountCents === null || amountCents <= 0) return { input: null, reason: "Enter an amount, e.g. 12.99." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return { input: null, reason: "Choose the next date." };
    if (!accountId) return { input: null, reason: "Choose the account it comes from." };
    if (!item) {
      return { input: { accountId, direction, name: name.trim(), amountCents, frequency, nextDate }, reason: undefined };
    }
    const patch: Record<string, unknown> = { recurringItemId: item.id };
    if (name.trim() !== item.name) patch.name = name.trim();
    if (amountCents !== item.amountCents) patch.amountCents = amountCents;
    if (frequency !== item.frequency) patch.frequency = frequency;
    if (nextDate !== item.nextDate) patch.nextDate = nextDate;
    if (accountId !== item.accountId) patch.accountId = accountId;
    if (Object.keys(patch).length === 1) return { input: null, reason: "Change something to review it." };
    return { input: patch, reason: undefined };
  }, [name, amountCents, frequency, nextDate, accountId, direction, item]);

  return (
    <Card title={item ? `Edit ${item.name}` : "Add a recurring item"}>
      <div className="rti-stack">
        <div className="rti-form">
          {!item && (
            <Select label="Type" value={direction} onChange={(e) => setDirection(e.target.value as "outflow" | "inflow")}>
              <option value="outflow">Charge or bill</option>
              <option value="inflow">Income</option>
            </Select>
          )}
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gym" />
          <Input label="Amount ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          <Select label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
            {item?.frequency === "unknown" && <option value="unknown">{FREQUENCY_LABELS.unknown}</option>}
          </Select>
          <Input label="Next date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          <Select label={direction === "inflow" ? "Paid into" : "Paid from"} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {payable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <ReviewAndConfirm
          action={item ? "recurring.edit" : "recurring.add"}
          input={input}
          invalidReason={reason}
          confirmLabel={item ? "Save changes" : "Add it"}
          onDone={onClose}
          onCancel={onClose}
        />
      </div>
    </Card>
  );
}
