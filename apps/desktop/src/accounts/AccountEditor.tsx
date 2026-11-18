/**
 * Rename, hide and fix the type of one account (§3 "For each new account I
 * can rename it, hide it, and fix its type"), through the registry actions
 * accounts.rename / accounts.setHidden / accounts.retype.
 */
import { useState } from "react";
import { ACCOUNT_KINDS, Money, type AccountKind } from "@ft/core";
import { useActions } from "../data/hooks.ts";
import { Input, Select, Toggle } from "../ui/components.tsx";
import { errorMessage } from "../connections/api.ts";
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

export function AccountEditor({ account, compact }: { account: EditableAccount; compact?: boolean }) {
  const actions = useActions();
  const [name, setName] = useState(account.name);
  const [savedName, setSavedName] = useState(account.name);
  const [hidden, setHidden] = useState(account.hidden);
  const [kind, setKind] = useState<AccountKind>(account.kind);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (name: string, input: unknown, revert: () => void) => {
    setBusy(true);
    setError(undefined);
    try {
      await actions.run(name, input);
    } catch (e) {
      revert();
      setError(errorMessage(e, "Couldn't save that change."));
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    const next = name.trim();
    if (!next || next === savedName) return;
    const before = savedName;
    setSavedName(next);
    void run("accounts.rename", { accountId: account.id, nickname: next }, () => {
      setSavedName(before);
      setName(before);
    });
  };

  return (
    <div className={`ft-account-editor${compact ? " ft-account-editor--compact" : ""}`}>
      <div className="ft-account-editor__name">
        <Input
          label={`Name${account.mask ? ` (••${account.mask})` : ""}`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && saveName()}
        />
      </div>
      <Select
        label="Type"
        value={kind}
        onChange={(e) => {
          const next = e.target.value as AccountKind;
          const before = kind;
          setKind(next);
          void run("accounts.retype", { accountId: account.id, kind: next }, () => setKind(before));
        }}
      >
        {ACCOUNT_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </Select>
      <div className="ft-account-editor__toggle">
        <Toggle
          label="Hidden"
          checked={hidden}
          disabled={busy}
          onChange={(v) => {
            setHidden(v);
            void run("accounts.setHidden", { accountId: account.id, hidden: v }, () => setHidden(!v));
          }}
        />
      </div>
      {account.balanceCents !== null && <span className="ft-account-editor__balance ft-num">{Money.format(account.balanceCents)}</span>}
      {error && (
        <p className="ft-account-editor__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
