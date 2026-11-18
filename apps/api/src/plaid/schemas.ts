/**
 * Runtime schemas for every Plaid response this app reads (§1 "Format
 * matches real data"). Each schema lists only the fields we use; parsing
 * fails loudly if one is missing or has the wrong type, in Sandbox and
 * production alike. Unknown fields are stripped by zod and then dropped again
 * by the trim functions (trim.ts) before anything is stored.
 *
 * Compile-time checks at the bottom prove each schema agrees with the
 * official Plaid SDK response type.
 */
import { z } from "zod";
import type { Plaid } from "plaid";
import type { PlaidEndpoint } from "./endpoints.ts";

const nullishString = z.string().nullish();
const nullishNumber = z.number().nullish();

export const accountSchema = z.object({
  account_id: z.string(),
  balances: z.object({
    current: z.number().nullable(),
    available: nullishNumber,
    iso_currency_code: z.string().nullable(),
    last_updated_datetime: nullishString,
  }),
  mask: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  subtype: z.string().nullable(),
});

export const personalFinanceCategorySchema = z.object({
  primary: z.string(),
  detailed: z.string(),
  confidence_level: nullishString,
});

export const transactionSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(),
  iso_currency_code: z.string().nullable(),
  date: z.string(),
  authorized_date: z.string().nullable(),
  pending: z.boolean(),
  pending_transaction_id: z.string().nullable(),
  name: z.string(),
  original_description: nullishString,
  merchant_name: nullishString,
  merchant_entity_id: nullishString,
  personal_finance_category: personalFinanceCategorySchema.nullish(),
});

const requestId = z.string();

export const linkTokenCreateSchema = z.object({
  link_token: z.string(),
  expiration: z.string(),
  hosted_link_url: nullishString,
  request_id: requestId,
});

export const linkTokenGetSchema = z.object({
  link_token: z.string(),
  link_sessions: z
    .array(
      z.object({
        link_session_id: z.string(),
        finished_at: nullishString,
        // Present when the user left Link without finishing: the session is cancelled, nothing is saved (§3).
        exit: z.object({ error: z.object({ error_code: z.string() }).nullish() }).nullish(),
        results: z
          .object({
            item_add_results: z
              .array(z.object({ public_token: z.string(), institution: z.object({ institution_id: nullishString, name: nullishString }).nullish() }))
              .nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
  request_id: requestId,
});

export const publicTokenExchangeSchema = z.object({
  access_token: z.string(),
  item_id: z.string(),
  request_id: requestId,
});

export const itemGetSchema = z.object({
  item: z.object({
    item_id: z.string(),
    institution_id: nullishString,
    institution_name: nullishString,
    error: z.object({ error_code: z.string() }).nullable(),
    consent_expiration_time: z.string().nullable(),
    // Products initialised on the item: sync only calls Investments/Liabilities when present (§4, §17).
    products: z.array(z.string()).nullish(),
  }),
  status: z
    .object({
      transactions: z.object({ last_successful_update: nullishString }).nullish(),
    })
    .nullish(),
  request_id: requestId,
});

export const accountsGetSchema = z.object({
  accounts: z.array(accountSchema),
  item: z.object({ item_id: z.string() }),
  request_id: requestId,
});

export const transactionsSyncSchema = z.object({
  accounts: z.array(accountSchema),
  added: z.array(transactionSchema),
  modified: z.array(transactionSchema),
  removed: z.array(z.object({ transaction_id: z.string(), account_id: nullishString })),
  next_cursor: z.string(),
  has_more: z.boolean(),
  transactions_update_status: z.string(),
  request_id: requestId,
});

const streamAmountSchema = z.object({ amount: z.number().nullish(), iso_currency_code: z.string().nullish() });

export const transactionStreamSchema = z.object({
  stream_id: z.string(),
  account_id: z.string(),
  description: z.string(),
  merchant_name: z.string().nullable(),
  frequency: z.string(),
  average_amount: streamAmountSchema,
  last_amount: streamAmountSchema,
  first_date: z.string(),
  last_date: z.string(),
  predicted_next_date: z.string().nullish(),
  is_active: z.boolean(),
  status: z.string(),
  transaction_ids: z.array(z.string()),
  personal_finance_category: personalFinanceCategorySchema.nullish(),
});

export const recurringGetSchema = z.object({
  inflow_streams: z.array(transactionStreamSchema),
  outflow_streams: z.array(transactionStreamSchema),
  request_id: requestId,
});

export const securitySchema = z.object({
  security_id: z.string(),
  name: z.string().nullable(),
  ticker_symbol: z.string().nullable(),
  type: z.string().nullable(),
});

export const holdingSchema = z.object({
  account_id: z.string(),
  security_id: z.string(),
  quantity: z.number(),
  institution_value: z.number(),
  iso_currency_code: z.string().nullable(),
});

export const holdingsGetSchema = z.object({
  accounts: z.array(accountSchema),
  holdings: z.array(holdingSchema),
  securities: z.array(securitySchema),
  request_id: requestId,
});

export const investmentTransactionSchema = z.object({
  investment_transaction_id: z.string(),
  account_id: z.string(),
  security_id: z.string().nullable(),
  date: z.string(),
  name: z.string(),
  quantity: z.number(),
  amount: z.number(),
  fees: z.number().nullable(),
  type: z.string(),
  subtype: z.string(),
  iso_currency_code: z.string().nullable(),
});

export const investmentTransactionsGetSchema = z.object({
  accounts: z.array(accountSchema),
  securities: z.array(securitySchema),
  investment_transactions: z.array(investmentTransactionSchema),
  total_investment_transactions: z.number(),
  request_id: requestId,
});

export const creditLiabilitySchema = z.object({
  account_id: z.string().nullable(),
  last_statement_balance: z.number().nullable(),
  last_statement_issue_date: z.string().nullable(),
  next_payment_due_date: z.string().nullable(),
  minimum_payment_amount: z.number().nullable(),
});

export const liabilitiesGetSchema = z.object({
  accounts: z.array(accountSchema),
  liabilities: z.object({
    credit: z.array(creditLiabilitySchema).nullable(),
  }),
  request_id: requestId,
});

export const institutionGetByIdSchema = z.object({
  institution: z.object({ institution_id: z.string(), name: z.string() }),
  request_id: requestId,
});

export const webhookVerificationKeySchema = z.object({
  key: z.object({
    alg: z.string(),
    crv: z.string(),
    kid: z.string(),
    kty: z.string(),
    use: z.string(),
    x: z.string(),
    y: z.string(),
    created_at: z.number(),
    expired_at: z.number().nullable(),
  }),
  request_id: requestId,
});

export const requestOnlySchema = z.object({ request_id: requestId });

export const sandboxPublicTokenCreateSchema = z.object({ public_token: z.string(), request_id: requestId });
export const sandboxFireWebhookSchema = z.object({ webhook_fired: z.boolean(), request_id: requestId });
export const sandboxResetLoginSchema = z.object({ reset_login: z.boolean(), request_id: requestId });

/** The schema each endpoint's response is validated with. */
export const RESPONSE_SCHEMAS = {
  "/link/token/create": linkTokenCreateSchema,
  "/link/token/get": linkTokenGetSchema,
  "/item/public_token/exchange": publicTokenExchangeSchema,
  "/item/get": itemGetSchema,
  "/accounts/get": accountsGetSchema,
  "/accounts/balance/get": accountsGetSchema,
  "/transactions/sync": transactionsSyncSchema,
  "/transactions/refresh": requestOnlySchema,
  "/transactions/recurring/get": recurringGetSchema,
  "/investments/holdings/get": holdingsGetSchema,
  "/investments/transactions/get": investmentTransactionsGetSchema,
  "/investments/refresh": requestOnlySchema,
  "/liabilities/get": liabilitiesGetSchema,
  "/institutions/get_by_id": institutionGetByIdSchema,
  "/webhook_verification_key/get": webhookVerificationKeySchema,
  "/sandbox/public_token/create": sandboxPublicTokenCreateSchema,
  "/sandbox/item/fire_webhook": sandboxFireWebhookSchema,
  "/sandbox/item/reset_login": sandboxResetLoginSchema,
  "/sandbox/transactions/create": requestOnlySchema,
} as const satisfies Record<PlaidEndpoint, z.ZodType>;

export type PlaidResponse<E extends PlaidEndpoint> = z.infer<(typeof RESPONSE_SCHEMAS)[E]>;

// ---------------------------------------------------------------- SDK agreement
// Each official SDK response type must be assignable to what our schema
// accepts, i.e. every field we validate exists in Plaid's type with a
// compatible type. If Plaid changes a field we rely on, typecheck fails here.
type Accepts<Schema extends z.ZodType, SdkType> = SdkType extends z.input<Schema> ? true : never;
const sdkAgreement: true[] = [
  true satisfies Accepts<typeof accountSchema, Plaid.AccountBase>,
  true satisfies Accepts<typeof transactionSchema, Plaid.Transaction>,
  true satisfies Accepts<typeof linkTokenCreateSchema, Plaid.LinkTokenCreateResponse>,
  true satisfies Accepts<typeof linkTokenGetSchema, Plaid.LinkTokenGetResponse>,
  true satisfies Accepts<typeof publicTokenExchangeSchema, Plaid.ItemPublicTokenExchangeResponse>,
  true satisfies Accepts<typeof itemGetSchema, Plaid.ItemGetResponse>,
  true satisfies Accepts<typeof accountsGetSchema, Plaid.AccountsGetResponse>,
  true satisfies Accepts<typeof transactionsSyncSchema, Plaid.TransactionsSyncResponse>,
  true satisfies Accepts<typeof transactionStreamSchema, Plaid.TransactionStream>,
  true satisfies Accepts<typeof recurringGetSchema, Plaid.TransactionsRecurringGetResponse>,
  true satisfies Accepts<typeof securitySchema, Plaid.Security>,
  true satisfies Accepts<typeof holdingSchema, Plaid.Holding>,
  true satisfies Accepts<typeof holdingsGetSchema, Plaid.InvestmentsHoldingsGetResponse>,
  true satisfies Accepts<typeof investmentTransactionSchema, Plaid.InvestmentTransaction>,
  true satisfies Accepts<typeof investmentTransactionsGetSchema, Plaid.InvestmentsTransactionsGetResponse>,
  true satisfies Accepts<typeof creditLiabilitySchema, Plaid.CreditCardLiability>,
  true satisfies Accepts<typeof liabilitiesGetSchema, Plaid.LiabilitiesGetResponse>,
  true satisfies Accepts<typeof institutionGetByIdSchema, Plaid.InstitutionsGetByIdResponse>,
  true satisfies Accepts<typeof webhookVerificationKeySchema, Plaid.WebhookVerificationKeyGetResponse>,
  true satisfies Accepts<typeof sandboxPublicTokenCreateSchema, Plaid.SandboxPublicTokenCreateResponse>,
];
void sdkAgreement;
