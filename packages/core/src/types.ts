/**
 * Shared domain types. These mirror the D1 tables in
 * apps/api/src/db/schema.ts (same names, camelCase); a type-level test in the
 * API keeps them in step. All money is integer cents, all dates are IsoDate.
 *
 * SIGN CONVENTIONS (decided once, applied at ingest):
 * - Transaction.amountCents: positive = money INTO the account (deposit,
 *   paycheck, refund, card payment received), negative = money OUT (purchase,
 *   withdrawal). Plaid uses the opposite sign, so ingest does
 *   `amountCents = -toCents(plaid.amount)`.
 * - Balances (Account.currentBalanceCents, BalanceSnapshot.balanceCents) are
 *   the account's contribution to net worth: assets positive, debts (credit
 *   cards, loans) negative. Plaid reports a card's owed balance as positive,
 *   so ingest negates balances of credit and loan accounts.
 */
import type { Cents } from "./money.ts";
import type { IsoDate } from "./dates.ts";

/** An ISO-8601 instant in UTC, e.g. "2026-11-18T09:30:00.000Z". */
export type IsoDateTime = string;

export type Id = string;
export type TransactionId = Id;
export type AccountId = Id;

// ---------------------------------------------------------------- enums

export const ACCOUNT_TYPES = ["depository", "credit", "loan", "investment", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The user-facing kind that drives grouping and math (§3 "fix its type"). */
export const ACCOUNT_KINDS = ["checking", "savings", "credit", "investment", "loan", "cash", "other"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ITEM_STATUSES = ["ok", "login_required", "pending_expiration", "error", "revoked"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Every transaction lands in exactly one bucket (§6). */
export const BUCKETS = ["spending", "income", "transfer", "poker"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const NECESSITY = ["necessary", "not_necessary"] as const;
export type Necessity = (typeof NECESSITY)[number];

export const LINK_SOURCES = ["auto", "manual"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

export const RULE_MATCH_KINDS = ["merchant", "description_contains"] as const;
export type RuleMatchKind = (typeof RULE_MATCH_KINDS)[number];

export const LABEL_TARGET_KINDS = ["category", "merchant"] as const;
export type LabelTargetKind = (typeof LABEL_TARGET_KINDS)[number];

export const BUDGET_PERIOD_KINDS = ["weekly", "biweekly", "monthly", "yearly", "custom"] as const;
export type BudgetPeriodKind = (typeof BUDGET_PERIOD_KINDS)[number];

export const BUDGET_PART_TARGET_KINDS = ["category", "merchant", "tag"] as const;
export type BudgetPartTargetKind = (typeof BUDGET_PART_TARGET_KINDS)[number];

export const CONTRIBUTION_PERIODS = ["weekly", "monthly", "yearly"] as const;
export type ContributionPeriod = (typeof CONTRIBUTION_PERIODS)[number];

export const RECURRING_FREQUENCIES = ["weekly", "biweekly", "semi_monthly", "monthly", "annually", "unknown"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_DIRECTIONS = ["outflow", "inflow"] as const;
export type RecurringDirection = (typeof RECURRING_DIRECTIONS)[number];

export const SNAPSHOT_SOURCES = ["plaid", "rebuilt", "manual", "carried_forward"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const ACTION_SOURCES = ["user", "ai"] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

// ---------------------------------------------------------------- connections & accounts

export interface PlaidItem {
  id: Id;
  plaidItemId: string;
  institutionId: string | null;
  institutionName: string | null;
  status: ItemStatus;
  errorCode: string | null;
  consentExpiresAt: IsoDateTime | null;
  lastSuccessfulUpdateAt: IsoDateTime | null;
  lastSyncedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface Account {
  id: AccountId;
  itemId: Id | null;
  plaidAccountId: string | null;
  name: string;
  nickname: string | null;
  mask: string | null;
  type: AccountType;
  subtype: string | null;
  kindOverride: AccountKind | null;
  isManual: boolean;
  hidden: boolean;
  protectedAmountCents: Cents;
  incomeFallback: boolean;
  isoCurrencyCode: string | null;
  currentBalanceCents: Cents | null;
  balanceUpdatedAt: IsoDateTime | null;
  connectedOn: IsoDate;
  createdAt: IsoDateTime;
}

// ---------------------------------------------------------------- transactions & edits

export interface Transaction {
  id: TransactionId;
  plaidTransactionId: string | null;
  accountId: AccountId;
  amountCents: Cents;
  isoCurrencyCode: string | null;
  date: IsoDate;
  authorizedDate: IsoDate | null;
  pending: boolean;
  pendingTransactionId: string | null;
  rawDescription: string;
  merchantName: string | null;
  merchantEntityId: string | null;
  plaidCategoryPrimary: string | null;
  plaidCategoryDetailed: string | null;
  plaidCategoryConfidence: string | null;
  isManual: boolean;
  removed: boolean;
  removedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TransactionOverride {
  transactionId: TransactionId;
  category: string | null;
  bucket: Bucket | null;
  necessity: Necessity | null;
  note: string | null;
  confirmedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
}

export interface Tag {
  id: Id;
  name: string;
  createdAt: IsoDateTime;
}

export interface TransactionTag {
  transactionId: TransactionId;
  tagId: Id;
}

export interface Split {
  id: Id;
  transactionId: TransactionId;
  amountCents: Cents;
  category: string | null;
  necessity: Necessity | null;
  note: string | null;
  position: number;
}

export interface TransferLink {
  id: Id;
  outTransactionId: TransactionId;
  inTransactionId: TransactionId;
  source: LinkSource;
  undoneAt: IsoDateTime | null;
  needsReview: boolean;
  createdAt: IsoDateTime;
}

export interface RefundLink {
  id: Id;
  refundTransactionId: TransactionId;
  purchaseTransactionId: TransactionId;
  source: LinkSource;
  undoneAt: IsoDateTime | null;
  needsReview: boolean;
  createdAt: IsoDateTime;
}

export interface Merchant {
  id: Id;
  name: string;
  createdAt: IsoDateTime;
}

export interface MerchantAlias {
  id: Id;
  merchantId: Id;
  /** Normalised key: Plaid merchant_entity_id, or a cleaned merchant/description string. */
  matchKey: string;
  source: LinkSource;
}

export interface Rule {
  id: Id;
  position: number;
  matchKind: RuleMatchKind;
  matchValue: string;
  accountId: AccountId | null;
  setCategory: string | null;
  setBucket: Bucket | null;
  setNecessity: Necessity | null;
  enabled: boolean;
  createdAt: IsoDateTime;
}

export interface NecessaryLabel {
  id: Id;
  targetKind: LabelTargetKind;
  targetValue: string;
  necessity: Necessity;
}

export interface CuttingBackItem {
  id: Id;
  targetKind: LabelTargetKind;
  targetValue: string;
  startedOn: IsoDate;
  endedOn: IsoDate | null;
}

// ---------------------------------------------------------------- budgets

export interface Budget {
  id: Id;
  name: string;
  periodKind: BudgetPeriodKind;
  anchorDate: IsoDate;
  customEndDate: IsoDate | null;
  archivedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface BudgetAmount {
  budgetId: Id;
  effectiveFrom: IsoDate;
  amountCents: Cents;
}

export interface BudgetPart {
  id: Id;
  budgetId: Id;
  name: string;
  expectedCents: Cents;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  position: number;
}

export interface BudgetPartTarget {
  partId: Id;
  targetKind: BudgetPartTargetKind;
  targetValue: string;
}

export interface Trip {
  id: Id;
  tagId: Id;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  expectedCents: Cents;
}

// ---------------------------------------------------------------- goals

export interface Goal {
  id: Id;
  name: string;
  accountId: AccountId;
  targetCents: Cents;
  priority: number;
  deadline: IsoDate | null;
  expectedContributionCents: Cents | null;
  contributionPeriod: ContributionPeriod | null;
  colorSlot: number;
  completedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
  purchaseTransactionId: TransactionId | null;
  createdAt: IsoDateTime;
}

export interface GoalMilestoneSeen {
  goalId: Id;
  milestoneCents: Cents;
  seenAt: IsoDateTime;
}

// ---------------------------------------------------------------- recurring & liabilities

export interface RecurringItem {
  id: Id;
  plaidStreamId: string | null;
  source: LinkSource;
  accountId: AccountId;
  direction: RecurringDirection;
  description: string;
  merchantName: string | null;
  category: string | null;
  frequency: RecurringFrequency;
  averageAmountCents: Cents;
  lastAmountCents: Cents | null;
  lastDate: IsoDate | null;
  predictedNextDate: IsoDate | null;
  isActive: boolean;
  plaidStatus: string | null;
  firstSeenOn: IsoDate;
}

export interface RecurringOverride {
  recurringItemId: Id;
  name: string | null;
  amountCents: Cents | null;
  nextDate: IsoDate | null;
  accountId: AccountId | null;
  frequency: RecurringFrequency | null;
  removed: boolean;
  updatedAt: IsoDateTime;
}

export interface RecurringItemTransaction {
  recurringItemId: Id;
  transactionId: TransactionId;
}

export interface Liability {
  accountId: AccountId;
  lastStatementBalanceCents: Cents | null;
  lastStatementIssueDate: IsoDate | null;
  nextPaymentDueDate: IsoDate | null;
  minimumPaymentCents: Cents | null;
  payingAccountId: AccountId | null;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------- investments

export interface Security {
  id: Id;
  plaidSecurityId: string;
  name: string | null;
  tickerSymbol: string | null;
  type: string | null;
}

export interface Holding {
  accountId: AccountId;
  securityId: Id;
  asOfDate: IsoDate;
  /** Share count, not money; may be fractional. */
  quantity: number;
  valueCents: Cents;
  isoCurrencyCode: string | null;
}

export interface InvestmentTransaction {
  id: Id;
  plaidInvestmentTransactionId: string | null;
  accountId: AccountId;
  securityId: Id | null;
  date: IsoDate;
  type: string;
  subtype: string | null;
  /** Same sign convention as Transaction.amountCents (positive = into the account's cash). */
  amountCents: Cents;
  quantity: number | null;
  feesCents: Cents | null;
  rawDescription: string;
  note: string | null;
}

// ---------------------------------------------------------------- snapshots

export interface BalanceSnapshot {
  accountId: AccountId;
  date: IsoDate;
  balanceCents: Cents;
  source: SnapshotSource;
  isEstimated: boolean;
  isCarriedForward: boolean;
}

// ---------------------------------------------------------------- system

export interface ActionLogEntry {
  id: Id;
  actionName: string;
  inputJson: string;
  summary: string;
  mutationsJson: string;
  inverseJson: string;
  source: ActionSource;
  appliedAt: IsoDateTime;
  undoneAt: IsoDateTime | null;
}

/**
 * Everything a query or action can read. The API loads only the slices a
 * query declares in `needs` (see registry.ts).
 */
export interface CoreData {
  items: PlaidItem[];
  accounts: Account[];
  transactions: Transaction[];
  overrides: TransactionOverride[];
  tags: Tag[];
  transactionTags: TransactionTag[];
  splits: Split[];
  transferLinks: TransferLink[];
  refundLinks: RefundLink[];
  merchants: Merchant[];
  merchantAliases: MerchantAlias[];
  rules: Rule[];
  necessaryLabels: NecessaryLabel[];
  cuttingBack: CuttingBackItem[];
  budgets: Budget[];
  budgetAmounts: BudgetAmount[];
  budgetParts: BudgetPart[];
  budgetPartTargets: BudgetPartTarget[];
  trips: Trip[];
  goals: Goal[];
  goalMilestonesSeen: GoalMilestoneSeen[];
  recurringItems: RecurringItem[];
  recurringOverrides: RecurringOverride[];
  recurringItemTransactions: RecurringItemTransaction[];
  liabilities: Liability[];
  securities: Security[];
  holdings: Holding[];
  investmentTransactions: InvestmentTransaction[];
  balanceSnapshots: BalanceSnapshot[];
}

export type DataKey = keyof CoreData;

export const DATA_KEYS = [
  "items",
  "accounts",
  "transactions",
  "overrides",
  "tags",
  "transactionTags",
  "splits",
  "transferLinks",
  "refundLinks",
  "merchants",
  "merchantAliases",
  "rules",
  "necessaryLabels",
  "cuttingBack",
  "budgets",
  "budgetAmounts",
  "budgetParts",
  "budgetPartTargets",
  "trips",
  "goals",
  "goalMilestonesSeen",
  "recurringItems",
  "recurringOverrides",
  "recurringItemTransactions",
  "liabilities",
  "securities",
  "holdings",
  "investmentTransactions",
  "balanceSnapshots",
] as const satisfies readonly DataKey[];

/** An empty CoreData, handy for tests: `{ ...emptyData(), transactions: [...] }`. */
export function emptyData(): CoreData {
  return Object.fromEntries(DATA_KEYS.map((k) => [k, []])) as unknown as CoreData;
}
