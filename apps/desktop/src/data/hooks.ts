/**
 * Shared data hooks for every window. Windows read data only through registry
 * queries (`/q/:name`) and change it only through registry actions (`/a/:name`),
 * the same ones the AI assistant uses (§1, §2, §16).
 *
 * After any action succeeds, a `ft:data-changed` event fires and every
 * mounted `useQuery` refetches, so all windows stay consistent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppToken } from "../shell/context.ts";
import { runAction, runQuery, previewAction, undoAction, type QueryResponse, type ActionResponse } from "../api/client.ts";

export const DATA_CHANGED_EVENT = "ft:data-changed";

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
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

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
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
      notifyDataChanged();
      return res;
    },
    undo: async (logId: string) => {
      const res = await undoAction(tokenRef.current, logId);
      notifyDataChanged();
      return res;
    },
  };
}
