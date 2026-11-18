/**
 * Manual Refresh (§4): asks Plaid to check every bank now, shows progress,
 * then "Up to date" or the specific error per bank. When Plaid limits how
 * often Refresh may run, it says when it's next available.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { notifyDataChanged } from "../data/hooks.ts";
import { connectionsApi, errorMessage, type ConnectionHealth, type RefreshOutcome } from "./api.ts";
import { requestReconnect } from "./events.ts";
import { notifyConnectionsChanged } from "./useConnections.ts";
import "./connections.css";

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The latest "next refresh" time when EVERY bank is rate-limited (null: Refresh can run now). */
export function nextRefreshAt(items: readonly ConnectionHealth[] | undefined, nowMs = Date.now()): string | null {
  if (!items || items.length === 0) return null;
  const limited = items.map((c) => (c.refreshAvailableAt && Date.parse(c.refreshAvailableAt) > nowMs ? c.refreshAvailableAt : null));
  if (limited.some((x) => x === null)) return null;
  return (limited as string[]).sort()[0]!;
}

export function RefreshButton({ token, connections }: { token: string; connections: readonly ConnectionHealth[] | undefined }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RefreshOutcome[] | null>(null);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const next = nextRefreshAt(connections);
  const none = connections !== undefined && connections.length === 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const refresh = async () => {
    setBusy(true);
    setError(undefined);
    setResults(null);
    setOpen(true);
    try {
      const r = await connectionsApi.refresh(token);
      setResults(r.items);
      notifyConnectionsChanged();
      notifyDataChanged();
    } catch (e) {
      setError(errorMessage(e, "Refresh failed."));
    } finally {
      setBusy(false);
    }
  };

  const allOk = results?.every((r) => r.status === "up_to_date" || r.status === "already_running");
  const label = busy ? "Refreshing…" : next ? `Next refresh ${time(next)}` : "Refresh";

  return (
    <div className="ft-refresh" ref={ref}>
      <Button size="sm" icon="refresh" onClick={() => void refresh()} disabled={busy || !!next || none} title={none ? "No banks connected" : undefined}>
        {label}
      </Button>
      {open && (busy || results || error) && (
        <div className="ft-refresh__panel" role="status" aria-live="polite">
          {busy && (
            <span className="ft-row">
              <span className="ft-spinner" aria-hidden="true" /> Asking every bank for new data…
            </span>
          )}
          {error && <span className="ft-refresh__err">{error}</span>}
          {results && results.length === 0 && <span>No banks to refresh.</span>}
          {results && allOk && results.length > 0 && (
            <strong className="ft-refresh__ok">
              <Icon name="check" size={14} /> Up to date
            </strong>
          )}
          {results?.map((r) => (
            <div key={r.itemId} className="ft-refresh__row">
              <span>{r.institutionName ?? "Bank"}</span>
              {r.status === "up_to_date" || r.status === "already_running" ? (
                <span className="ft-refresh__ok">
                  <Icon name="check" size={12} /> {r.status === "already_running" ? "Already syncing" : "Up to date"}
                </span>
              ) : r.status === "rate_limited" ? (
                <span className="ft-muted">Synced · next refresh {r.refreshAvailableAt ? time(r.refreshAvailableAt) : "later"}</span>
              ) : (
                <span className="ft-refresh__err">
                  {r.message ?? r.errorCode ?? "Error"}{" "}
                  <button type="button" className="ft-link" onClick={() => requestReconnect(r.itemId)}>
                    Reconnect
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
