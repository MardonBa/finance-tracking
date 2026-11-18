/**
 * Broken connections (§4): right after Touch ID (this mounts when the app
 * gate unlocks), if any bank needs signing in again, reported an error, or
 * is about to lose access, a prompt names the bank and the problem and
 * offers Reconnect (Plaid update mode in the system browser, same deep-link
 * return as adding a bank). Dismissing it leaves the affected accounts marked
 * out of date wherever they show (Overview balances, account sheets).
 *
 * It also handles reconnect requests from anywhere (requestReconnect()).
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Dialog } from "../dialogs/Dialog.tsx";
import { notifyDataChanged } from "../data/hooks.ts";
import { connectionsApi, needsAttention, type ConnectionHealth } from "./api.ts";
import { RECONNECT_EVENT, SHOW_CONNECTION_PROMPT_EVENT } from "./events.ts";
import { defaultConnectDeps, useConnectFlow, type ConnectDeps } from "./useConnectFlow.ts";
import { notifyConnectionsChanged, relativeTime } from "./useConnections.ts";
import "./connections.css";

export interface ConnectionHealthHostProps {
  token: string;
  /** For tests: the connection flow's dependencies. */
  deps?: ConnectDeps;
  /** For tests: the health check. */
  loadHealth?: () => Promise<{ items: ConnectionHealth[] }>;
}

function problemLabel(c: ConnectionHealth): string {
  if (c.status === "pending_expiration") return c.consentExpiresAt ? `Access ends ${new Date(c.consentExpiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Access ends soon";
  if (c.status === "login_required") return "Needs you to sign in again";
  if (c.status === "revoked") return "Access was revoked";
  return "Reported an error";
}

export function ConnectionHealthHost({ token, deps, loadHealth }: ConnectionHealthHostProps) {
  const [problems, setProblems] = useState<ConnectionHealth[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState<{ itemId: string; institutionName: string | null } | null>(null);
  const [known, setKnown] = useState<ConnectionHealth[]>([]);

  // Once per unlock (the gate mounts this right after Touch ID), and again on request.
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const on = () => setCheck((n) => n + 1);
    window.addEventListener(SHOW_CONNECTION_PROMPT_EVENT, on);
    return () => window.removeEventListener(SHOW_CONNECTION_PROMPT_EVENT, on);
  }, []);
  useEffect(() => {
    let live = true;
    void check;
    (loadHealth ?? (() => connectionsApi.health(token)))().then(
      (r) => {
        if (!live) return;
        setKnown(r.items);
        const bad = r.items.filter(needsAttention);
        setProblems(bad);
        if (bad.length > 0) setPromptOpen(true);
      },
      () => undefined, // No prompt when the check itself fails; the Overview shows the state when it loads.
    );
    return () => {
      live = false;
    };
  }, [token, loadHealth, check]);

  useEffect(() => {
    const on = (e: Event) => {
      const itemId = String((e as CustomEvent<string>).detail);
      const c = [...problems, ...known].find((x) => x.itemId === itemId);
      setPromptOpen(false);
      setReconnecting({ itemId, institutionName: c?.institutionName ?? null });
    };
    window.addEventListener(RECONNECT_EVENT, on);
    return () => window.removeEventListener(RECONNECT_EVENT, on);
  }, [problems, known]);

  return (
    <>
      {promptOpen && problems.length > 0 && (
        <Dialog
          title={problems.length === 1 ? `${problems[0]!.institutionName ?? "A bank"} needs attention` : `${problems.length} banks need attention`}
          eyebrow="Bank connections"
          onClose={() => setPromptOpen(false)}
          footer={
            <Button variant="ghost" onClick={() => setPromptOpen(false)}>
              Not now
            </Button>
          }
        >
          <div className="ft-stack">
            <p className="ft-flow-text">Until it's fixed, balances from these banks stay as they were and are marked out of date.</p>
            <div className="ft-reconnect-list">
              {problems.map((c) => (
                <div key={c.itemId} className="ft-reconnect-item">
                  <span className="ft-reconnect-item__text">
                    <strong>
                      <Icon name="warning" size={14} /> {c.institutionName ?? "Bank"}: {problemLabel(c)}
                    </strong>
                    <span className="ft-muted">{c.message}</span>
                    <span className="ft-small ft-muted">Last updated {relativeTime(c.lastUpdatedAt)}</span>
                  </span>
                  <Button variant="primary" size="sm" icon="refresh" onClick={() => setReconnecting({ itemId: c.itemId, institutionName: c.institutionName })}>
                    Reconnect
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {reconnecting && (
        <ReconnectDialog
          token={token}
          deps={deps}
          itemId={reconnecting.itemId}
          institutionName={reconnecting.institutionName}
          onDone={(fixed) => {
            setReconnecting(null);
            if (fixed) {
              const rest = problems.filter((p) => p.itemId !== reconnecting.itemId);
              setProblems(rest);
              if (rest.length > 0) setPromptOpen(true);
              notifyConnectionsChanged();
              notifyDataChanged();
            }
          }}
        />
      )}
    </>
  );
}

function ReconnectDialog({
  token,
  deps,
  itemId,
  institutionName,
  onDone,
}: {
  token: string;
  deps?: ConnectDeps;
  itemId: string;
  institutionName: string | null;
  onDone: (fixed: boolean) => void;
}) {
  const flowDeps = useMemo(() => deps ?? defaultConnectDeps(token), [deps, token]);
  const flow = useConnectFlow(flowDeps, { mode: "update", itemId, institutionName });
  const cur = flow.state.current;
  const bank = institutionName ?? "your bank";
  // The user already chose Reconnect: open Plaid straight away.
  const start = flow.start;
  useEffect(() => {
    start();
  }, [start]);

  let body;
  let footer;
  switch (cur.step) {
    case "intro":
    case "starting":
      body = (
        <p className="ft-row ft-flow-text">
          <span className="ft-spinner" aria-hidden="true" /> Opening Plaid…
        </p>
      );
      footer = (
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      );
      break;
    case "waiting":
    case "finalizing":
      body = (
        <div className="ft-stack">
          <p className="ft-flow-text">Plaid is open in your browser. Sign in to {bank} there; all your history is kept. You'll come back here when it's done.</p>
          <p className="ft-row ft-muted" role="status">
            <span className="ft-spinner" aria-hidden="true" /> {cur.step === "finalizing" ? "Checking with Plaid…" : "Waiting for Plaid…"}
          </p>
        </div>
      );
      footer = (
        <>
          <Button icon="external" onClick={flow.reopen}>
            Open Plaid again
          </Button>
          <Button variant="ghost" onClick={flow.cancel}>
            Cancel
          </Button>
        </>
      );
      break;
    case "connected":
      body = (
        <p className="ft-note ft-note--ok" role="status">
          <Icon name="check" size={16} /> {institutionName ?? "The bank"} is reconnected and syncing now.
        </p>
      );
      footer = (
        <Button variant="primary" onClick={() => onDone(true)}>
          Done
        </Button>
      );
      break;
    case "duplicate":
    case "cancelled":
    case "failed":
      body = (
        <p className={`ft-note ${cur.step === "failed" ? "ft-note--danger" : ""}`} role="alert">
          <Icon name="warning" size={16} /> {cur.step === "duplicate" ? "Plaid returned a different bank." : cur.message}
        </p>
      );
      footer = (
        <>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Not now
          </Button>
          <Button variant="primary" icon="refresh" onClick={flow.retry}>
            Try again
          </Button>
        </>
      );
      break;
  }

  return (
    <Dialog title={`Reconnect ${bank}`} eyebrow="Bank connections" onClose={() => onDone(cur.step === "connected")} footer={footer}>
      {body}
    </Dialog>
  );
}
