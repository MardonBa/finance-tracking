/**
 * Account sheets opened from anywhere (the Overview's balances, the "Add
 * account" menu): one account's details, and adding a manual account.
 * Mounted once over the desktop (auth/Ready.tsx); opened with window events
 * so any window can ask without sharing state.
 */
import { useEffect, useRef, useState } from "react";
import { Money, type AccountKind } from "@ft/core";
import { useActions, useQuery } from "../data/hooks.ts";
import { ConfirmDialog, Dialog } from "../dialogs/Dialog.tsx";
import { Button } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { errorMessage, needsAttention } from "../connections/api.ts";
import { relativeTime, useConnections } from "../connections/useConnections.ts";
import { requestReconnect } from "../connections/events.ts";
import { AccountEditor } from "./AccountEditor.tsx";
import { ManualAccountForm, ManualTransactions } from "./manual.tsx";

export const OPEN_ACCOUNT_EVENT = "ft:open-account";
export const ADD_MANUAL_ACCOUNT_EVENT = "ft:add-manual-account";

export function openAccountSheet(accountId: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_ACCOUNT_EVENT, { detail: accountId }));
}

export function openManualAccountDialog(): void {
  window.dispatchEvent(new Event(ADD_MANUAL_ACCOUNT_EVENT));
}

export interface AccountRow {
  id: string;
  itemId: string | null;
  name: string;
  bankName: string;
  mask: string | null;
  kind: AccountKind;
  isManual: boolean;
  hidden: boolean;
  balanceCents: number | null;
  balanceUpdatedAt: string | null;
}

export function AccountSheets({ token }: { token: string }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);

  useEffect(() => {
    const open = (e: Event) => setAccountId(String((e as CustomEvent<string>).detail));
    const manual = () => setAddingManual(true);
    window.addEventListener(OPEN_ACCOUNT_EVENT, open);
    window.addEventListener(ADD_MANUAL_ACCOUNT_EVENT, manual);
    return () => {
      window.removeEventListener(OPEN_ACCOUNT_EVENT, open);
      window.removeEventListener(ADD_MANUAL_ACCOUNT_EVENT, manual);
    };
  }, []);

  return (
    <>
      {accountId && <AccountSheet token={token} accountId={accountId} onClose={() => setAccountId(null)} />}
      {addingManual && (
        <Dialog title="Add a manual account" onClose={() => setAddingManual(false)}>
          <ManualAccountForm onCreated={() => setAddingManual(false)} onCancel={() => setAddingManual(false)} />
        </Dialog>
      )}
    </>
  );
}

function AccountSheet({ token, accountId, onClose }: { token: string; accountId: string; onClose: () => void }) {
  const accounts = useQuery<{ accounts: AccountRow[] }>("accounts.list", { includeHidden: true });
  const connections = useConnections(token);
  const actions = useActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const account = accounts.data?.value.accounts.find((a) => a.id === accountId);
  const seen = useRef(false);
  if (account) seen.current = true;

  // Deleted (or never existed): close.
  useEffect(() => {
    if (accounts.data && !account && seen.current) onClose();
  }, [accounts.data, account, onClose]);

  if (!account) {
    return (
      <Dialog title="Account" onClose={onClose}>
        <p className="ft-muted">{accounts.error ? errorMessage(accounts.error) : "Loading…"}</p>
      </Dialog>
    );
  }
  const conn = account.itemId ? connections.items?.find((c) => c.itemId === account.itemId) : undefined;

  const remove = async () => {
    setBusy(true);
    try {
      await actions.run("accounts.deleteManualAccount", { accountId: account.id });
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Couldn't delete the account."));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog title={account.name} eyebrow={account.isManual ? "Manual account" : (conn?.institutionName ?? account.bankName)} onClose={onClose} width="lg">
        <div className="ft-stack">
          <div className="ft-row ft-row--between">
            <span className="ft-sheet-balance ft-num">{account.balanceCents === null ? "No balance yet" : Money.format(account.balanceCents)}</span>
            {account.isManual ? (
              <span className="ft-badge">
                <Icon name="cash" size={12} /> Manual
              </span>
            ) : (
              <span className={`ft-badge${conn && needsAttention(conn) ? " ft-badge--warning" : ""}`}>
                Updated {relativeTime(conn?.lastUpdatedAt ?? account.balanceUpdatedAt)}
              </span>
            )}
          </div>
          {conn && needsAttention(conn) && (
            <p className="ft-note ft-note--warning" role="status">
              <Icon name="warning" size={16} />
              <span>
                {conn.message}. Balances here may be out of date.{" "}
                <Button size="sm" variant="primary" onClick={() => requestReconnect(conn.itemId)}>
                  Reconnect
                </Button>
              </span>
            </p>
          )}
          <AccountEditor
            key={account.id}
            account={{ id: account.id, name: account.name, mask: account.mask, kind: account.kind, hidden: account.hidden, balanceCents: null, isManual: account.isManual }}
          />
          {account.isManual && <ManualTransactions accountId={account.id} />}
          {error && (
            <p className="ft-note ft-note--danger" role="alert">
              {error}
            </p>
          )}
          {account.isManual && (
            <div className="ft-row ft-row--end">
              <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                Delete account
              </Button>
            </div>
          )}
        </div>
      </Dialog>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${account.name}?`}
          message={<p>This deletes the manual account and every transaction you entered in it, and removes it from net worth.</p>}
          confirmLabel="Delete account"
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
