/**
 * Connection health (§4 "Broken connections"): maps Plaid error codes and
 * item state to our item status, and to the plain-English message the
 * reconnect prompt shows.
 */
import type { ItemStatus } from "@ft/core";

/** Errors the user fixes by signing in again through Link's update mode. */
const LOGIN_REQUIRED = new Set([
  "ITEM_LOGIN_REQUIRED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "INVALID_UPDATED_USERNAME",
  "ITEM_LOCKED",
  "USER_SETUP_REQUIRED",
  "MFA_NOT_SUPPORTED",
  "NO_ACCOUNTS",
  "ACCESS_NOT_GRANTED",
  "INSUFFICIENT_CREDENTIALS",
  "USER_INPUT_TIMEOUT",
]);

/** Errors meaning the user withdrew access at the bank or at Plaid. */
const REVOKED = new Set(["USER_PERMISSION_REVOKED", "USER_ACCOUNT_REVOKED", "ITEM_NOT_FOUND", "ACCESS_TOKEN_INVALID"]);

/** Errors that are temporary on Plaid's or the bank's side: retried by the next sync, no prompt. */
const TRANSIENT = new Set([
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INSTITUTION_NO_LONGER_SUPPORTED",
  "INTERNAL_SERVER_ERROR",
  "PLANNED_MAINTENANCE",
  "PRODUCT_NOT_READY",
  "RATE_LIMIT_EXCEEDED",
  "TRANSACTIONS_LIMIT",
  "ITEM_GET_LIMIT",
]);

export function statusForError(code: string): ItemStatus {
  if (LOGIN_REQUIRED.has(code)) return "login_required";
  if (REVOKED.has(code)) return "revoked";
  return "error";
}

export function isTransient(code: string | null | undefined): boolean {
  return !!code && TRANSIENT.has(code);
}

/** Days before consent expiry that we start prompting. TODO(revisit): 7 days. */
export const CONSENT_WARNING_DAYS = 7;

export function consentExpiringSoon(consentExpiresAt: string | null, nowMs: number): boolean {
  if (!consentExpiresAt) return false;
  return Date.parse(consentExpiresAt) - nowMs <= CONSENT_WARNING_DAYS * 86_400_000;
}

const MESSAGES: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: "needs you to sign in again",
  INVALID_CREDENTIALS: "needs you to sign in again (the saved login no longer works)",
  INVALID_MFA: "needs you to sign in again (verification code)",
  ITEM_LOCKED: "locked the account after too many attempts; sign in at the bank, then reconnect",
  USER_SETUP_REQUIRED: "needs you to finish a setup step on the bank's website",
  NO_ACCOUNTS: "no longer shares any accounts; reconnect and choose accounts",
  ACCESS_NOT_GRANTED: "no longer shares the data this app needs; reconnect and allow access",
  PENDING_EXPIRATION: "access is about to expire; reconnect to keep it working",
  PENDING_DISCONNECT: "will disconnect soon (the bank is changing how it connects); reconnect to keep it working",
  USER_PERMISSION_REVOKED: "access was revoked; reconnect to resume",
  USER_ACCOUNT_REVOKED: "access was revoked at the bank; reconnect to resume",
  INSTITUTION_DOWN: "is temporarily unavailable; it will retry automatically",
  INSTITUTION_NOT_RESPONDING: "is not responding right now; it will retry automatically",
  RATE_LIMIT_EXCEEDED: "asked us to slow down; try again later",
};

export function messageFor(status: ItemStatus, errorCode: string | null, institutionName: string | null): string {
  const bank = institutionName ?? "This bank";
  if (status === "ok" && !errorCode) return `${bank} is up to date`;
  if (status === "pending_expiration") return `${bank} ${MESSAGES[errorCode ?? "PENDING_EXPIRATION"] ?? MESSAGES.PENDING_EXPIRATION}`;
  const known = errorCode ? MESSAGES[errorCode] : undefined;
  if (known) return `${bank} ${known}`;
  if (status === "login_required") return `${bank} ${MESSAGES.ITEM_LOGIN_REQUIRED}`;
  if (status === "revoked") return `${bank} ${MESSAGES.USER_PERMISSION_REVOKED}`;
  return `${bank} reported an error${errorCode ? ` (${errorCode})` : ""}`;
}

/** Whether the app should prompt to reconnect right after Touch ID (§4). */
export function needsReconnect(status: ItemStatus): boolean {
  return status === "login_required" || status === "pending_expiration" || status === "revoked";
}
