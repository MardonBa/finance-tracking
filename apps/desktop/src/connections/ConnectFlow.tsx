/**
 * The bank connection flow's screens (§3), driven by useConnectFlow.
 * Used by the first-run "Add banks" step, the "Add account" dialog, and
 * (update mode) the reconnect prompt.
 */
import { useState } from "react";
import { Button } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { AccountEditor, kindFromPlaid } from "../accounts/AccountEditor.tsx";
import { ManualAccountForm } from "../accounts/manual.tsx";
import type { ConnectFlow as Flow } from "./useConnectFlow.ts";
import type { ConnectedBank, ConnectState } from "./machine.ts";
import { canStart } from "./machine.ts";
import { useConnections } from "./useConnections.ts";
import "../dialogs/dialogs.css";
import "./connections.css";

function LimitNote({ state }: { state: ConnectState }) {
  const l = state.limit;
  if (state.limitError) return <p className="ft-note ft-note--warning">Couldn't check Plaid's connection limit ({state.limitError}). You can still try.</p>;
  if (!l || l.status === "ok") return null;
  if (l.status === "reached") {
    return (
      <p className="ft-note ft-note--danger" role="alert">
        <Icon name="warning" size={16} />
        <span>
          All {l.limit} bank connections in Plaid's Trial are used, so another bank can't be added right now. A manual account still works.
        </span>
      </p>
    );
  }
  return (
    <p className="ft-note ft-note--warning" role="status">
      <Icon name="warning" size={16} />
      <span>
        {l.count} of Plaid's {l.limit} Trial bank connections are used: {l.remaining} left.
      </span>
    </p>
  );
}

/** Per-bank import status while history downloads ("Importing transactions…" → "Up to date"). */
export function ImportStatusList({ token, banks }: { token: string; banks: ConnectedBank[] }) {
  const health = useConnections(token, { pollWhileImporting: true });
  if (banks.length === 0) return null;
  return (
    <ul className="ft-list" aria-label="Connected banks">
      {banks.map((b) => {
        const h = health.items?.find((c) => c.itemId === b.itemId);
        const visible = b.accounts.filter((a) => !a.hidden).length;
        let status = <span className="ft-muted">Checking…</span>;
        if (h && (h.status === "error" || h.needsReconnect)) {
          status = (
            <span className="ft-badge ft-badge--warning">
              <Icon name="warning" size={12} /> {h.message}
            </span>
          );
        } else if (h?.importStatus === "up_to_date") {
          status = (
            <span className="ft-badge ft-badge--ok">
              <Icon name="check" size={12} /> Up to date
            </span>
          );
        } else if (h) {
          status = (
            <span className="ft-row ft-small">
              <span className="ft-spinner" aria-hidden="true" /> Importing transactions…
            </span>
          );
        }
        return (
          <li key={b.itemId} className="ft-row ft-row--between">
            <span>
              <Icon name="bank" size={16} /> <strong>{b.institutionName ?? "Bank"}</strong>{" "}
              <span className="ft-muted">
                · {visible} account{visible === 1 ? "" : "s"}
                {b.keptDuplicate ? " · duplicates hidden" : ""}
              </span>
            </span>
            {status}
          </li>
        );
      })}
    </ul>
  );
}

export interface ConnectFlowViewProps {
  token: string;
  flow: Flow;
  onFinish: () => void;
  /** First run: "Skip for now" instead of "Close" when nothing was connected. */
  firstRun?: boolean;
}

export function ConnectFlowView({ token, flow, onFinish, firstRun }: ConnectFlowViewProps) {
  const { state } = flow;
  const cur = state.current;
  const [manual, setManual] = useState(false);
  const [manualAdded, setManualAdded] = useState<string[]>([]);
  const finishLabel = state.banks.length > 0 || manualAdded.length > 0 ? "Finish" : firstRun ? "Skip for now" : "Close";

  const finishRow = (
    <div className="ft-row ft-row--end">
      <Button variant="ghost" onClick={onFinish}>
        {finishLabel}
      </Button>
    </div>
  );

  if (manual) {
    return (
      <div className="ft-stack">
        <h2 className="ft-flow-title">Add a manual account</h2>
        <ManualAccountForm
          onCreated={(name) => {
            setManualAdded((m) => [...m, name]);
            setManual(false);
          }}
          onCancel={() => setManual(false)}
        />
      </div>
    );
  }

  switch (cur.step) {
    case "intro":
      return (
        <div className="ft-stack">
          <h2 className="ft-flow-title">{state.banks.length > 0 ? "Add another bank" : "Add your banks"}</h2>
          <p className="ft-flow-text">
            Plaid opens in your browser. Search for your bank and sign in there; some banks, like Chase, take you to their own site. When it's done, you
            come back here automatically. Plaid only gets read access: nothing here can move money.
          </p>
          <LimitNote state={state} />
          {cur.notice && <p className="ft-note">{cur.notice}</p>}
          <ImportStatusList token={token} banks={state.banks} />
          {manualAdded.length > 0 && <p className="ft-muted">Added manual: {manualAdded.join(", ")}</p>}
          <div className="ft-row">
            <Button variant="primary" icon="bank" onClick={flow.start} disabled={!canStart(state)}>
              Connect a bank
            </Button>
            <Button icon="cash" onClick={() => setManual(true)}>
              Add a manual account
            </Button>
          </div>
          {finishRow}
        </div>
      );
    case "starting":
      return (
        <div className="ft-stack" aria-busy="true">
          <h2 className="ft-flow-title">Opening Plaid…</h2>
          <p className="ft-row ft-flow-text">
            <span className="ft-spinner" aria-hidden="true" /> Starting a secure session with Plaid.
          </p>
        </div>
      );
    case "waiting":
    case "finalizing":
      return (
        <div className="ft-stack">
          <h2 className="ft-flow-title">Finish in your browser</h2>
          <p className="ft-flow-text">
            Plaid is open in your browser. Pick your bank and sign in; you'll come back here when it's done. If you close Plaid, nothing is saved.
          </p>
          <p className="ft-row ft-muted" role="status">
            <span className="ft-spinner" aria-hidden="true" /> {cur.step === "finalizing" ? "Checking with Plaid…" : "Waiting for Plaid…"}
          </p>
          <div className="ft-row">
            <Button icon="external" onClick={flow.reopen}>
              Open Plaid again
            </Button>
            <Button variant="ghost" onClick={flow.cancel}>
              Cancel
            </Button>
          </div>
        </div>
      );
    case "duplicate":
      return (
        <div className="ft-stack">
          <h2 className="ft-flow-title">{cur.institutionName ?? "This bank"} looks already connected</h2>
          <p className="ft-flow-text">So nothing is counted twice, choose what to do with this new connection.</p>
          <ul className="ft-list">
            {cur.duplicates.flatMap((d) =>
              d.matchingAccounts.map((m) => (
                <li key={`${d.existingItemId}-${m.existingAccountId}-${m.newAccountName}`}>
                  <strong>{m.newAccountName}</strong>
                  {m.mask ? ` ••${m.mask}` : ""} <span className="ft-muted">matches {m.existingAccountName}{d.existingInstitutionName ? ` at ${d.existingInstitutionName}` : ""}</span>
                </li>
              )),
            )}
          </ul>
          <div className="ft-row">
            <Button variant="primary" onClick={() => flow.resolveDuplicate("discard")} disabled={cur.resolving}>
              Discard the new connection
            </Button>
            <Button onClick={() => flow.resolveDuplicate("keep")} disabled={cur.resolving}>
              Keep it (matching accounts hidden)
            </Button>
          </div>
        </div>
      );
    case "connected":
      return (
        <div className="ft-stack">
          {cur.last ? (
            <>
              <h2 className="ft-flow-title">
                <Icon name="check" size={18} /> {cur.last.institutionName ?? "Bank"} connected
              </h2>
              <p className="ft-flow-text">These accounts were found. Rename them, hide any you don't want counted, or fix a type Plaid got wrong.</p>
              <div className="ft-stack ft-found-accounts">
                {cur.last.accounts
                  .filter((a): a is typeof a & { id: string } => a.id !== null)
                  .map((a) => (
                    <AccountEditor
                      key={a.id}
                      compact
                      account={{ id: a.id, name: a.name, mask: a.mask, kind: kindFromPlaid(a.type, a.subtype), hidden: a.hidden, balanceCents: a.currentBalanceCents }}
                    />
                  ))}
              </div>
            </>
          ) : (
            <h2 className="ft-flow-title">Nothing new was added</h2>
          )}
          {cur.notice && <p className="ft-note">{cur.notice}</p>}
          <ImportStatusList token={token} banks={state.banks} />
          <div className="ft-row ft-row--between">
            <Button icon="plus" onClick={flow.addAnother}>
              Add another bank
            </Button>
            <Button variant="primary" onClick={onFinish}>
              Finish
            </Button>
          </div>
        </div>
      );
    case "cancelled":
    case "failed":
      return (
        <div className="ft-stack">
          <h2 className="ft-flow-title">{cur.step === "cancelled" ? "Connection cancelled" : "Couldn't connect"}</h2>
          <p className={`ft-note ${cur.step === "failed" ? "ft-note--danger" : ""}`} role="alert">
            <Icon name={cur.step === "failed" ? "warning" : "info"} size={16} />
            <span>{cur.message}</span>
          </p>
          <div className="ft-row">
            <Button variant="primary" icon="refresh" onClick={flow.retry} disabled={!canStart(state)}>
              Try again
            </Button>
            <Button variant="ghost" onClick={flow.addAnother}>
              Back
            </Button>
          </div>
          {finishRow}
        </div>
      );
  }
}
