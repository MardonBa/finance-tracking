/**
 * Rename, hide and fix the type of one account (§3 "For each new account I
 * can rename it, hide it, and fix its type"). Changes are collected, then
 * shown before → after (ui/ActionConfirm) and saved through the registry
 * actions accounts.rename / accounts.setHidden / accounts.retype.
 */
import { useState } from "react";
import { ACCOUNT_KINDS, Money, type AccountKind } from "@ft/core";
import { Button, Input, Select, Toggle } from "../ui/components.tsx";
import type { ActionStep } from "../ui/ActionConfirm.tsx";
import { ConfirmActions } from "../dialogs/ConfirmActions.tsx";
import "./accounts.css";

export const KIND_LABELS: Record<AccountKind, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
  other: "Other",
};

/** Plaid's type/subtype as our account kind, for the type picker's starting value. */
export function kindFromPlaid(type: string, subtype: string | null): AccountKind {
  if (type === "credit") return "credit";
  if (type === "investment" || type === "brokerage") return "investment";
  if (type === "loan") return "loan";
  if (type === "depository") return subtype === "savings" || subtype === "money market" || subtype === "cd" ? "savings" : "checking";
  return "other";
}

export interface EditableAccount {
  id: string;
  name: string;
  mask: string | null;
  kind: AccountKind;
  hidden: boolean;
  balanceCents: number | null;
  isManual?: boolean;
}

interface Values {
  name: string;
  kind: AccountKind;
  hidden: boolean;
}

/** The registry actions that turn `saved` into `next` (only what changed). */
export function accountEditSteps(accountId: string, saved: Values, next: Values): ActionStep[] {
  const steps: ActionStep[] = [];
  const name = next.name.trim();
  if (name && name !== saved.name) steps.push({ name: "accounts.rename", input: { accountId, nickname: name } });
  if (next.kind !== saved.kind) steps.push({ name: "accounts.retype", input: { accountId, kind: next.kind } });
  if (next.hidden !== saved.hidden) steps.push({ name: "accounts.setHidden", input: { accountId, hidden: next.hidden } });
  return steps;
}

export function AccountEditor({ account, compact }: { account: EditableAccount; compact?: boolean }) {
  const [saved, setSaved] = useState<Values>({ name: account.name, kind: account.kind, hidden: account.hidden });
  const [draft, setDraft] = useState<Values>(saved);
  const [confirming, setConfirming] = useState(false);
  const steps = accountEditSteps(account.id, saved, draft);

  return (
    <div className={`ft-account-editor${compact ? " ft-account-editor--compact" : ""}`}>
      <div className="ft-account-editor__name">
        <Input label={`Name${account.mask ? ` (••${account.mask})` : ""}`} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <Select label="Type" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AccountKind })}>
        {ACCOUNT_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </Select>
      <div className="ft-account-editor__toggle">
        <Toggle label="Hidden" checked={draft.hidden} onChange={(v) => setDraft({ ...draft, hidden: v })} />
      </div>
      <div className="ft-account-editor__end">
        {account.balanceCents !== null && <span className="ft-account-editor__balance ft-num">{Money.format(account.balanceCents)}</span>}
        {steps.length > 0 && (
          <Button size="sm" variant="primary" onClick={() => setConfirming(true)}>
            Save
          </Button>
        )}
      </div>
      {confirming && (
        <ConfirmActions
          title={`Change ${saved.name}`}
          steps={steps}
          confirmLabel="Save"
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setSaved({ ...draft, name: draft.name.trim() || saved.name });
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}
