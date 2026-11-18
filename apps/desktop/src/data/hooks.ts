/**
 * Shared data hooks for every window. Windows read data only through registry
 * queries (`/q/:name`) and change it only through registry actions (`/a/:name`),
 * the same ones the AI assistant uses (§1, §2, §16).
 *
 * After any action succeeds, a `ft:data-changed` event fires. It names the
 * data slices the action changed; a mounted `useQuery` refetches only if its
 * query reads one of them (the backend reports both). An event without slices
 * (bank refresh, reconnect, new bank) refetches everything.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppToken } from "../shell/context.ts";
import { runAction, runQuery, previewAction, undoAction, type QueryResponse, type ActionResponse } from "../api/client.ts";

export const DATA_CHANGED_EVENT = "ft:data-changed";

export interface DataChangedDetail {
  /** Slices that changed; undefined means "anything may have changed". */
  slices?: readonly string[];
}

export function notifyDataChanged(slices?: readonly string[]): void {
  window.dispatchEvent(new CustomEvent<DataChangedDetail>(DATA_CHANGED_EVENT, { detail: { slices } }));
}

/** Should a query that reads `needs` refetch after this change? Unknown on either side: yes. */
export function affects(needs: readonly string[] | undefined, changed: readonly string[] | undefined): boolean {
  if (!needs || !changed) return true;
  return changed.some((s) => needs.includes(s));
}

export interface QueryState<V> {
  data: QueryResponse<V> | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/** Run a registry query; re-runs when `params` (compared as JSON) change or data changes. */
export function useQuery<V>(name: string, params: unknown = {}): QueryState<V> {
  const token = useAppToken();
  const key = JSON.stringify(params ?? {});
  const [state, setState] = useState<Omit<QueryState<V>, "refetch">>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const needsRef = useRef<readonly string[] | undefined>(undefined);
  needsRef.current = state.data?.needs;

  useEffect(() => {
    const onChange = (e: Event) => {
      if (affects(needsRef.current, (e as CustomEvent<DataChangedDetail | undefined>).detail?.slices)) setTick((t) => t + 1);
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    runQuery<V>(token, name, JSON.parse(key)).then(
      (data) => live && setState({ data, error: undefined, loading: false }),
      (error: Error) => live && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [token, name, key, tick]);

  return { ...state, refetch };
}

/** Preview, run and undo registry actions. Running or undoing notifies all queries. */
export function useActions() {
  const token = useAppToken();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  return {
    preview: (name: string, input: unknown) => previewAction(tokenRef.current, name, input),
    run: async (name: string, input: unknown): Promise<ActionResponse> => {
      const res = await runAction(tokenRef.current, name, input);
      notifyDataChanged(res.changed);
      return res;
    },
    undo: async (logId: string) => {
      const res = await undoAction(tokenRef.current, logId);
      notifyDataChanged(res.changed);
      return res;
    },
  };
}
