/**
 * Typed calls to the backend's connection, sync and credential routes
 * (apps/api/src/routes/connections.ts, auth.ts). Shapes mirror the API.
 */
import { apiRequest } from "../api/client.ts";

export type TrialStatusKind = "ok" | "close" | "reached";

export interface TrialStatus {
  count: number;
  limit: number;
  remaining: number;
  status: TrialStatusKind;
}

export interface LinkSession {
  sessionId: string;
  hostedLinkUrl: string;
  expiresAt: string;
  mode: "new" | "update";
}

export interface FoundAccount {
  /** Our account id once saved (null for a duplicate still waiting for a decision). */
  id: string | null;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  hidden: boolean;
}

export interface DuplicateMatch {
  existingItemId: string;
  existingInstitutionName: string | null;
  sameInstitution: boolean;
  matchingAccounts: Array<{ newAccountName: string; mask: string | null; existingAccountId: string; existingAccountName: string }>;
}

export type FinalizeResult =
  | { status: "pending" | "finalizing"; sessionId: string }
  | { status: "done"; sessionId: string; itemId: string; institutionName: string | null; accounts: FoundAccount[] }
  | { status: "duplicate"; sessionId: string; institutionName: string | null; accounts: FoundAccount[]; duplicates: DuplicateMatch[] }
  | { status: "cancelled" | "failed"; sessionId: string; errorCode: string | null };

export type ItemStatus = "ok" | "login_required" | "pending_expiration" | "revoked" | "error";

export interface ConnectionHealth {
  itemId: string;
  institutionName: string | null;
  status: ItemStatus;
  errorCode: string | null;
  message: string;
  needsReconnect: boolean;
  lastUpdatedAt: string | null;
  lastUpdatedSource: "plaid" | "sync" | null;
  consentExpiresAt: string | null;
  importStatus: "importing" | "up_to_date";
  syncing: boolean;
  refreshAvailableAt: string | null;
  accountCount: number;
}

export interface RefreshOutcome {
  itemId: string;
  institutionName: string | null;
  status: "up_to_date" | "rate_limited" | "already_running" | "error";
  errorCode?: string;
  message?: string;
  refreshAvailableAt?: string;
}

export interface Credential {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  current: boolean;
}

const post = (body: unknown = {}): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const connectionsApi = {
  limit: (token: string) => apiRequest<TrialStatus>("/connections/limit", token),
  /** Start Hosted Link: a new bank, or update mode for `itemId` (reconnect). */
  createSession: (token: string, itemId?: string) => apiRequest<LinkSession>("/connections/link", token, post(itemId ? { itemId } : {})),
  finalize: (token: string, sessionId: string) => apiRequest<FinalizeResult>("/connections/finalize", token, post({ sessionId })),
  resolveDuplicate: (token: string, sessionId: string, choice: "keep" | "discard") =>
    apiRequest<FinalizeResult>("/connections/duplicate", token, post({ sessionId, choice })),
  health: (token: string) => apiRequest<{ items: ConnectionHealth[] }>("/connections", token),
  refresh: (token: string) => apiRequest<{ items: RefreshOutcome[] }>("/refresh", token, post()),
  credentials: (token: string) => apiRequest<{ credentials: Credential[] }>("/auth/credentials", token),
};

/** The backend's error body is `{ error, message }`; show the message when there is one. */
export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof Error) {
    try {
      const body = JSON.parse(e.message) as { message?: string; error?: string };
      if (body.message) return body.message;
      if (body.error) return body.error;
    } catch {
      // not JSON
    }
    return e.message || fallback;
  }
  return fallback;
}

/** Whether a connection should be prompted about right after Touch ID (§4): sign-in needed, expiring, revoked, or an error. */
export function needsAttention(c: ConnectionHealth): boolean {
  return c.needsReconnect || c.status === "error";
}
