/**
 * Typed client for the backend's registry routes. The base URL comes from
 * VITE_API_URL (defaults to the local `wrangler dev` server). The app token
 * is supplied by the caller (the shell reads it from the Keychain after
 * Touch ID); this module never stores it.
 */
import type { ActionPreview, Figure } from "@ft/core";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

/**
 * In `npm run dev` only: the DEV_APP_TOKEN registered by `npm run reset:dev`,
 * until Google sign-in (backend track) issues real tokens. Always undefined in
 * production builds.
 */
export const DEV_APP_TOKEN: string | undefined = import.meta.env.DEV ? import.meta.env.VITE_DEV_APP_TOKEN || undefined : undefined;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface QueryResponse<V> {
  value: V;
  figures: Record<string, Figure>;
}

export interface ActionResponse {
  logId: string;
  preview: ActionPreview;
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!res.ok) {
    const body = res.status === 401 ? "" : await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}

export function runQuery<V>(token: string, name: string, params: unknown): Promise<QueryResponse<V>> {
  return call(`/q/${encodeURIComponent(name)}`, token, { method: "POST", body: JSON.stringify(params ?? {}) });
}

export function previewAction(token: string, name: string, input: unknown): Promise<{ preview: ActionPreview }> {
  return call(`/a/${encodeURIComponent(name)}/preview`, token, { method: "POST", body: JSON.stringify(input) });
}

export function runAction(token: string, name: string, input: unknown): Promise<ActionResponse> {
  return call(`/a/${encodeURIComponent(name)}`, token, { method: "POST", body: JSON.stringify(input) });
}

export function undoAction(token: string, logId: string): Promise<{ undone: string }> {
  return call(`/actions/${encodeURIComponent(logId)}/undo`, token, { method: "POST" });
}
