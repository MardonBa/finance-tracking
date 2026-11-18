/**
 * The ONLY Plaid endpoints this app may call (§2 "No money can move").
 * Read-only products: Transactions, Balance, Investments, Liabilities (and
 * Recurring/Refresh, part of Transactions/Investments), plus Link, item
 * status, institution names and webhook verification.
 *
 * Never: Auth, Identity, Transfer, Payment Initiation, processor tokens,
 * item/remove, or anything that exposes account/routing numbers or moves
 * money. test/node/plaid-allowlist.test.ts fails if this list changes from
 * its snapshot or gains a forbidden endpoint.
 */
import type { Plaid } from "plaid";

/** Request types come from the official Plaid SDK; the client adds client_id/secret. */
export interface ReadOnlyEndpoints {
  "/link/token/create": Plaid.LinkTokenCreateRequest;
  "/link/token/get": Plaid.LinkTokenGetRequest;
  "/item/public_token/exchange": Plaid.ItemPublicTokenExchangeRequest;
  "/item/get": Plaid.ItemGetRequest;
  "/accounts/get": Plaid.AccountsGetRequest;
  "/accounts/balance/get": Plaid.AccountsBalanceGetRequest;
  "/transactions/sync": Plaid.TransactionsSyncRequest;
  "/transactions/refresh": Plaid.TransactionsRefreshRequest;
  "/transactions/recurring/get": Plaid.TransactionsRecurringGetRequest;
  "/investments/holdings/get": Plaid.InvestmentsHoldingsGetRequest;
  "/investments/transactions/get": Plaid.InvestmentsTransactionsGetRequest;
  "/investments/refresh": Plaid.InvestmentsRefreshRequest;
  "/liabilities/get": Plaid.LiabilitiesGetRequest;
  "/institutions/get_by_id": Plaid.InstitutionsGetByIdRequest;
  "/webhook_verification_key/get": Plaid.WebhookVerificationKeyGetRequest;
}

/**
 * SANDBOX-ONLY endpoints, used by `npm run reset:dev` and tests to create
 * fake items and simulate events. The client refuses them unless env is
 * "sandbox", so production can never call them.
 */
export interface SandboxOnlyEndpoints {
  "/sandbox/public_token/create": Plaid.SandboxPublicTokenCreateRequest;
  "/sandbox/item/fire_webhook": Plaid.SandboxItemFireWebhookRequest;
  "/sandbox/item/reset_login": Plaid.SandboxItemResetLoginRequest;
  "/sandbox/transactions/create": Plaid.SandboxTransactionsCreateRequest;
}

export type ReadOnlyEndpoint = keyof ReadOnlyEndpoints;
export type SandboxOnlyEndpoint = keyof SandboxOnlyEndpoints;
export type PlaidEndpoint = ReadOnlyEndpoint | SandboxOnlyEndpoint;
export type PlaidRequest<E extends PlaidEndpoint> = (ReadOnlyEndpoints & SandboxOnlyEndpoints)[E];

export const READ_ONLY_ENDPOINTS = [
  "/link/token/create",
  "/link/token/get",
  "/item/public_token/exchange",
  "/item/get",
  "/accounts/get",
  "/accounts/balance/get",
  "/transactions/sync",
  "/transactions/refresh",
  "/transactions/recurring/get",
  "/investments/holdings/get",
  "/investments/transactions/get",
  "/investments/refresh",
  "/liabilities/get",
  "/institutions/get_by_id",
  "/webhook_verification_key/get",
] as const satisfies readonly ReadOnlyEndpoint[];

export const SANDBOX_ONLY_ENDPOINTS = [
  "/sandbox/public_token/create",
  "/sandbox/item/fire_webhook",
  "/sandbox/item/reset_login",
  "/sandbox/transactions/create",
] as const satisfies readonly SandboxOnlyEndpoint[];

// Compile-time: the runtime lists cover every typed endpoint and nothing else.
type Missing<A, B> = Exclude<A, B>;
const _readOnlyComplete: Missing<ReadOnlyEndpoint, (typeof READ_ONLY_ENDPOINTS)[number]> extends never ? true : false = true;
const _sandboxComplete: Missing<SandboxOnlyEndpoint, (typeof SANDBOX_ONLY_ENDPOINTS)[number]> extends never ? true : false = true;
void _readOnlyComplete;
void _sandboxComplete;

/** Plaid products this app may request in Link. Never auth, identity, transfer, payment_initiation. */
export const ALLOWED_PRODUCTS = ["transactions", "investments", "liabilities"] as const;
