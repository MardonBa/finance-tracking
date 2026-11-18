/**
 * Connection health (GET /connections, §4) for any component: refetches
 * whenever data changes (an action, a refresh, a reconnect) and, while a
 * bank is still importing its history, every few seconds.
 */
import { useCallback, useEffect, useState } from "react";
import { DATA_CHANGED_EVENT } from "../data/hooks.ts";
import { connectionsApi, type ConnectionHealth } from "./api.ts";

export const CONNECTIONS_CHANGED_EVENT = "ft:connections-changed";

export function notifyConnectionsChanged(): void {
  window.dispatchEvent(new Event(CONNECTIONS_CHANGED_EVENT));
}

export interface ConnectionsState {
  items: ConnectionHealth[] | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

const IMPORT_POLL_MS = 4000;

export function useConnections(token: string, opts: { pollWhileImporting?: boolean } = {}): ConnectionsState {
  const [state, setState] = useState<Omit<ConnectionsState, "refetch">>({ items: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(DATA_CHANGED_EVENT, on);
    window.addEventListener(CONNECTIONS_CHANGED_EVENT, on);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, on);
      window.removeEventListener(CONNECTIONS_CHANGED_EVENT, on);
    };
  }, []);

  useEffect(() => {
    let live = true;
    connectionsApi.health(token).then(
      (r) => live && setState({ items: r.items, error: undefined, loading: false }),
      (error: Error) => live && setState((s) => ({ ...s, error, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [token, tick]);

  const importing = !!opts.pollWhileImporting && !!state.items?.some((c) => c.importStatus === "importing" || c.syncing);
  useEffect(() => {
    if (!importing) return;
    const t = setInterval(() => setTick((x) => x + 1), IMPORT_POLL_MS);
    return () => clearInterval(t);
  }, [importing]);

  return { ...state, refetch };
}

/** "2 hours ago", "yesterday", "Nov 3": for "last updated" labels. */
export function relativeTime(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return "never";
  const ms = nowMs - Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A bank counts as out of date when it needs attention or hasn't updated in 2 days (the daily sync missed). TODO(revisit): 48 h assumed. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function isOutOfDate(c: ConnectionHealth, nowMs: number = Date.now()): boolean {
  if (c.needsReconnect || c.status === "error") return true;
  if (!c.lastUpdatedAt) return c.importStatus !== "importing";
  return nowMs - Date.parse(c.lastUpdatedAt) > STALE_AFTER_MS;
}
