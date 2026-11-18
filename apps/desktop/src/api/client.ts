/**
 * Typed client for the backend's registry routes. The base URL comes from
 * VITE_API_URL (defaults to the local `wrangler dev` server). The app token
 * is supplied by the caller (the shell reads it from the Keychain after
 * Touch ID); this module never stores it.
 */
import type { ActionPreview, Figure } from "@ft/core";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

/**
 * Dev-only bypass of Google sign-in and Touch ID: the DEV_APP_TOKEN registered
 * by `npm run reset:dev`. Used ONLY in dev builds AND when the explicit flag
 * VITE_DEV_AUTH_BYPASS=1 is set (e.g. `VITE_DEV_AUTH_BYPASS=1 npm run dev`).
 * Always undefined in production builds.
 * TODO(revisit): sync-dev-vars doesn't write the flag; pass it on the command line.
 */
export const DEV_APP_TOKEN: string | undefined =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "1" ? import.meta.env.VITE_DEV_APP_TOKEN || undefined : undefined;

let onUnauthorized: (() => void) | null = null;

/**
 * Called on any 401 from the API (revoked or expired credential): the app
 * gate deletes the credential and goes back to Google sign-in (§2).
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

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

/** Any backend route (connections, refresh, auth), with the same 401 handling as queries. */
export function apiRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return call<T>(path, token, init);
}

/** Authenticated JSON call to the API (also used by the assistant window, windows/assistant/api.ts). */
export async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
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

/** Revoke the current credential (`{ all: true }`: every credential, e.g. a lost laptop). */
export function revokeCredential(token: string, opts: { all?: boolean } = {}): Promise<{ revoked: number }> {
  return call("/auth/revoke", token, { method: "POST", body: JSON.stringify(opts.all ? { all: true } : {}) });
}
