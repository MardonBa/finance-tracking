/**
 * trim* functions: turn a validated Plaid object into ONLY the fields we
 * store (§2 "trimmed to the allowed fields before it is saved"). Amounts are
 * converted to integer cents here, once, with toCents (§1), and signs are
 * flipped to our convention (see packages/core/src/types.ts).
 *
 * Owner names, addresses, locations, payment metadata, counterparties,
 * account numbers, logos and URLs never get past these functions.
 */
import type { z } from "zod";
import { toCents, type AccountType, type Account, type Cents, type Transaction } from "@ft/core";
import type {
  accountSchema,
  creditLiabilitySchema,
  holdingSchema,
  investmentTransactionSchema,
  itemGetSchema,
  securitySchema,
  transactionSchema,
  transactionStreamSchema,
} from "./schemas.ts";

const DEBT_TYPES = new Set<AccountType>(["credit", "loan"]);

export function accountType(plaidType: string): AccountType {
  switch (plaidType) {
    case "depository":
    case "credit":
    case "loan":
    case "investment":
      return plaidType;
    case "brokerage":
      return "investment";
    default:
      return "other";
  }
}

/** Plaid reports what is owed on debts as positive; we store net-worth contributions. */
export function balanceContributionCents(type: AccountType, current: number | null): Cents | null {
  if (current === null) return null;
  const cents = toCents(current);
  return DEBT_TYPES.has(type) ? (cents === 0 ? 0 : -cents) : cents;
}

const negate = (c: Cents): Cents => (c === 0 ? 0 : -c);

export type TrimmedAccount = Pick<
  Account,
  "plaidAccountId" | "name" | "mask" | "type" | "subtype" | "isoCurrencyCode" | "currentBalanceCents" | "balanceUpdatedAt"
>;

export function trimAccount(a: z.infer<typeof accountSchema>, fetchedAt: string): TrimmedAccount {
  const type = accountType(a.type);
  return {
    plaidAccountId: a.account_id,
    name: a.name,
    mask: a.mask === null ? null : a.mask.slice(-4),
    type,
    subtype: a.subtype,
    isoCurrencyCode: a.balances.iso_currency_code,
    currentBalanceCents: balanceContributionCents(type, a.balances.current),
    balanceUpdatedAt: a.balances.last_updated_datetime ?? fetchedAt,
  };
}

export type TrimmedTransaction = Pick<
  Transaction,
  | "plaidTransactionId"
  | "amountCents"
  | "isoCurrencyCode"
  | "date"
  | "authorizedDate"
  | "pending"
  | "pendingTransactionId"
  | "rawDescription"
  | "merchantName"
  | "merchantEntityId"
  | "plaidCategoryPrimary"
  | "plaidCategoryDetailed"
  | "plaidCategoryConfidence"
> & { plaidAccountId: string };

export function trimTransaction(t: z.infer<typeof transactionSchema>): TrimmedTransaction {
  return {
    plaidTransactionId: t.transaction_id,
    plaidAccountId: t.account_id,
    amountCents: negate(toCents(t.amount)), // Plaid: positive = money out; ours: positive = money in
    isoCurrencyCode: t.iso_currency_code,
    date: t.date,
    authorizedDate: t.authorized_date,
    pending: t.pending,
    pendingTransactionId: t.pending_transaction_id,
    rawDescription: t.original_description ?? t.name,
    merchantName: t.merchant_name ?? null,
    merchantEntityId: t.merchant_entity_id ?? null,
    plaidCategoryPrimary: t.personal_finance_category?.primary ?? null,
    plaidCategoryDetailed: t.personal_finance_category?.detailed ?? null,
    plaidCategoryConfidence: t.personal_finance_category?.confidence_level ?? null,
  };
}

export interface TrimmedItem {
  plaidItemId: string;
  institutionId: string | null;
  institutionName: string | null;
  errorCode: string | null;
  consentExpiresAt: string | null;
  lastSuccessfulUpdateAt: string | null;
}

export function trimItem(r: z.infer<typeof itemGetSchema>): TrimmedItem {
  return {
    plaidItemId: r.item.item_id,
    institutionId: r.item.institution_id ?? null,
    institutionName: r.item.institution_name ?? null,
    errorCode: r.item.error?.error_code ?? null,
    consentExpiresAt: r.item.consent_expiration_time,
    lastSuccessfulUpdateAt: r.status?.transactions?.last_successful_update ?? null,
  };
}

const FREQUENCIES = {
  WEEKLY: "weekly",
  BIWEEKLY: "biweekly",
  SEMI_MONTHLY: "semi_monthly",
  MONTHLY: "monthly",
  ANNUALLY: "annually",
} as const;

export interface TrimmedStream {
  plaidStreamId: string;
  plaidAccountId: string;
  direction: "inflow" | "outflow";
  description: string;
  merchantName: string | null;
  category: string | null;
  frequency: (typeof FREQUENCIES)[keyof typeof FREQUENCIES] | "unknown";
  averageAmountCents: Cents;
  lastAmountCents: Cents | null;
  lastDate: string;
  predictedNextDate: string | null;
  isActive: boolean;
  plaidStatus: string;
  firstDate: string;
  plaidTransactionIds: string[];
}

/** Stream amounts are reported as positive magnitudes in Plaid's sign; we store our sign per direction. */
export function trimStream(s: z.infer<typeof transactionStreamSchema>, direction: "inflow" | "outflow"): TrimmedStream {
  const signed = (amount: number | null | undefined): Cents | null => {
    if (amount === null || amount === undefined) return null;
    return negate(toCents(amount));
  };
  return {
    plaidStreamId: s.stream_id,
    plaidAccountId: s.account_id,
    direction,
    description: s.description,
    merchantName: s.merchant_name,
    category: s.personal_finance_category?.detailed ?? null,
    frequency: FREQUENCIES[s.frequency as keyof typeof FREQUENCIES] ?? "unknown",
    averageAmountCents: signed(s.average_amount.amount) ?? 0,
    lastAmountCents: signed(s.last_amount.amount),
    lastDate: s.last_date,
    predictedNextDate: s.predicted_next_date ?? null,
    isActive: s.is_active,
    plaidStatus: s.status,
    firstDate: s.first_date,
    plaidTransactionIds: [...s.transaction_ids],
  };
}

export interface TrimmedSecurity {
  plaidSecurityId: string;
  name: string | null;
  tickerSymbol: string | null;
  type: string | null;
}

export function trimSecurity(s: z.infer<typeof securitySchema>): TrimmedSecurity {
  return { plaidSecurityId: s.security_id, name: s.name, tickerSymbol: s.ticker_symbol, type: s.type };
}

export interface TrimmedHolding {
  plaidAccountId: string;
  plaidSecurityId: string;
  quantity: number;
  valueCents: Cents;
  isoCurrencyCode: string | null;
}

export function trimHolding(h: z.infer<typeof holdingSchema>): TrimmedHolding {
  return {
    plaidAccountId: h.account_id,
    plaidSecurityId: h.security_id,
    quantity: h.quantity,
    valueCents: toCents(h.institution_value),
    isoCurrencyCode: h.iso_currency_code,
  };
}

export interface TrimmedInvestmentTransaction {
  plaidInvestmentTransactionId: string;
  plaidAccountId: string;
  plaidSecurityId: string | null;
  date: string;
  type: string;
  subtype: string;
  amountCents: Cents;
  quantity: number;
  feesCents: Cents | null;
  rawDescription: string;
}

export function trimInvestmentTransaction(t: z.infer<typeof investmentTransactionSchema>): TrimmedInvestmentTransaction {
  return {
    plaidInvestmentTransactionId: t.investment_transaction_id,
    plaidAccountId: t.account_id,
    plaidSecurityId: t.security_id,
    date: t.date,
    type: t.type,
    subtype: t.subtype,
    amountCents: negate(toCents(t.amount)), // Plaid: positive = cash out of the account (a buy)
    quantity: t.quantity,
    feesCents: t.fees === null ? null : toCents(t.fees),
    rawDescription: t.name,
  };
}

export interface TrimmedCreditLiability {
  plaidAccountId: string | null;
  lastStatementBalanceCents: Cents | null;
  lastStatementIssueDate: string | null;
  nextPaymentDueDate: string | null;
  minimumPaymentCents: Cents | null;
}

export function trimCreditLiability(l: z.infer<typeof creditLiabilitySchema>): TrimmedCreditLiability {
  return {
    plaidAccountId: l.account_id,
    lastStatementBalanceCents: l.last_statement_balance === null ? null : toCents(l.last_statement_balance),
    lastStatementIssueDate: l.last_statement_issue_date,
    nextPaymentDueDate: l.next_payment_due_date,
    minimumPaymentCents: l.minimum_payment_amount === null ? null : toCents(l.minimum_payment_amount),
  };
}
