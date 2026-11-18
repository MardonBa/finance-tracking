/**
 * D1 schema (Drizzle). Rules (§2 "Store only what the visualizations need"):
 *
 * - EVERY column has a trailing `//` comment giving the reason it is stored
 *   (which visualization, calculation or rule needs it). A test enforces this.
 * - Never stored: full account or routing numbers, account-owner identity
 *   (names, addresses, emails, phone numbers), transaction location data.
 *   A test fails on columns that look like any of those.
 * - Money is integer cents; dates are "YYYY-MM-DD"; instants are ISO-8601 UTC.
 * - Sign conventions are documented in packages/core/src/types.ts.
 * - TS property names match the @ft/core domain types (checked at compile
 *   time in conformance.ts), so rows load straight into CoreData.
 *
 * Change this file, then run `npm run db:generate -w @ft/api` to create the
 * next SQL migration in apps/api/migrations.
 */
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ACCOUNT_KINDS,
  ACCOUNT_TYPES,
  ACTION_SOURCES,
  BUCKETS,
  BUDGET_PART_TARGET_KINDS,
  BUDGET_PERIOD_KINDS,
  CONTRIBUTION_PERIODS,
  ITEM_STATUSES,
  LABEL_TARGET_KINDS,
  LINK_SOURCES,
  NECESSITY,
  RECURRING_DIRECTIONS,
  RECURRING_FREQUENCIES,
  RULE_MATCH_KINDS,
  SNAPSHOT_SOURCES,
} from "@ft/core";

const bool = (name: string) => integer(name, { mode: "boolean" });

// =================================================================== connections

export const plaidItems = sqliteTable(
  "plaid_items",
  {
    id: text("id").primaryKey(), // our stable id, referenced by accounts and sync runs
    plaidItemId: text("plaid_item_id").notNull(), // routes Plaid webhooks (they name the item) to this connection
    institutionId: text("institution_id"), // detects connecting the same bank twice (§3 duplicates)
    institutionName: text("institution_name"), // names the bank in reconnect prompts and import status (§3, §4)
    accessTokenEnc: text("access_token_enc").notNull(), // AES-GCM ciphertext (iv+data, base64) of the Plaid access token; needed for every sync; key is the TOKEN_ENC_KEY Workers secret (§2)
    transactionsCursor: text("transactions_cursor"), // /transactions/sync cursor so each sync fetches only changes and is safe to repeat (§4)
    status: text("status", { enum: ITEM_STATUSES }).notNull().default("ok"), // drives the reconnect prompt and out-of-date markers (§4)
    errorCode: text("error_code"), // Plaid error code shown as "what's wrong" in the reconnect prompt (§4)
    consentExpiresAt: text("consent_expires_at"), // warns before bank consent (e.g. Chase OAuth) expires (§4)
    lastSuccessfulUpdateAt: text("last_successful_update_at"), // Plaid's last successful update, shown as "last updated" (§4)
    lastSyncedAt: text("last_synced_at"), // our own last sync time, the fallback for "last updated" (§4, decision 006)
    createdAt: text("created_at").notNull(), // when the bank was connected; investment history starts here (§5, §17)
    transactionsUpdateStatus: text("transactions_update_status"), // backend-only: Plaid's history download state (HISTORICAL_UPDATE_COMPLETE…) behind "Importing transactions…" → "Up to date" (§3)
    refreshAvailableAt: text("refresh_available_at"), // backend-only: when Plaid's refresh rate limit allows Refresh again, so the button can say when (§4 Open)
  },
  (t) => [uniqueIndex("plaid_items_plaid_item_id_uq").on(t.plaidItemId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(), // our stable id, referenced by transactions, snapshots, goals
    itemId: text("item_id").references(() => plaidItems.id), // which connection the account came from; null for manual accounts
    plaidAccountId: text("plaid_account_id"), // matches accounts in Plaid responses during sync; null for manual accounts
    name: text("name").notNull(), // Plaid's account name, shown where no nickname is set
    nickname: text("nickname"), // user's rename (§3 "rename it")
    mask: text("mask"), // last 2–4 digits only, to tell similar accounts apart and spot duplicates (§3); never the full number
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(), // Plaid's type; asset vs debt sign for net worth (§5)
    subtype: text("subtype"), // Plaid's subtype (checking, savings, credit card…) for default grouping (§5)
    kindOverride: text("kind_override", { enum: ACCOUNT_KINDS }), // user's fix when Plaid got the type wrong (§3)
    isManual: bool("is_manual").notNull().default(false), // manual (cash) accounts are labelled and edited by hand (§3)
    hidden: bool("hidden").notNull().default(false), // user hid the account from views (§3)
    protectedAmountCents: integer("protected_amount_cents").notNull().default(0), // emergency fund filled before any goal (decision 004)
    incomeFallback: bool("income_fallback").notNull().default(false), // "count deposits to this account as income" fallback (decision 005)
    isoCurrencyCode: text("iso_currency_code"), // guards against summing non-USD balances as dollars
    currentBalanceCents: integer("current_balance_cents"), // latest balance as a net-worth contribution (debts negative); Overview balances and goal funding (§5, §11, §13)
    balanceUpdatedAt: text("balance_updated_at"), // when that balance was fetched, for "last updated" (§4)
    connectedOn: text("connected_on").notNull(), // day the account was added; history that can't be rebuilt starts here (§5)
    createdAt: text("created_at").notNull(), // row creation time, for audit and ordering
  },
  (t) => [uniqueIndex("accounts_plaid_account_id_uq").on(t.plaidAccountId)],
);

// =================================================================== transactions

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // our stable id; provenance and drill-down point at it (§1, §7)
    plaidTransactionId: text("plaid_transaction_id"), // dedupes repeated syncs and applies modified/removed updates (§4); null for manual
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id), // which account it hit; per-account reconciliation and filters (§6, §7)
    amountCents: integer("amount_cents").notNull(), // signed cents, positive = into the account; every total (§1)
    isoCurrencyCode: text("iso_currency_code"), // guards against summing non-USD amounts as dollars
    date: text("date").notNull(), // posted date; fallback when there is no authorized date (decision 005)
    authorizedDate: text("authorized_date"), // purchase date; charges count on this date when present (decision 005)
    pending: bool("pending").notNull(), // pending charges never count in totals, shown faded (decision 005)
    pendingTransactionId: text("pending_transaction_id"), // links a posted transaction to its pending one so edits carry over (§4)
    rawDescription: text("raw_description").notNull(), // the bank's description, needed for transfer matching and merchant rules (§2, §6)
    merchantName: text("merchant_name"), // Plaid's cleaned merchant, shown with every transaction (§6, §7)
    merchantEntityId: text("merchant_entity_id"), // Plaid's stable merchant id, groups name variants into one merchant (§7)
    plaidCategoryPrimary: text("plaid_category_primary"), // Plaid category, the last step of the rule order (decision 005)
    plaidCategoryDetailed: text("plaid_category_detailed"), // detailed category (e.g. INCOME_INTEREST_EARNED) for income and transfer detection (§6)
    plaidCategoryConfidence: text("plaid_category_confidence"), // low confidence puts the transaction in "Needs a look" (§6)
    isManual: bool("is_manual").notNull().default(false), // hand-entered (cash) transactions can be edited and deleted (§3)
    removed: bool("removed").notNull().default(false), // Plaid removed it; kept flagged so linked edits can be reviewed (§4)
    removedAt: text("removed_at"), // when Plaid removed it, for the review list (§4)
    createdAt: text("created_at").notNull(), // first time we saw it; "new" markers and audit
    updatedAt: text("updated_at").notNull(), // last change from Plaid or the user; sync debugging
  },
  (t) => [
    uniqueIndex("transactions_plaid_transaction_id_uq").on(t.plaidTransactionId),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_date_idx").on(t.date),
  ],
);

export const overrides = sqliteTable("transaction_overrides", {
  transactionId: text("transaction_id")
    .primaryKey()
    .references(() => transactions.id), // the transaction the user fixed
  category: text("category"), // user's category fix, first in the rule order (§6)
  bucket: text("bucket", { enum: BUCKETS }), // user's spending/income/transfer/Poker choice (§6)
  necessity: text("necessity", { enum: NECESSITY }), // per-transaction necessary override (§8)
  note: text("note"), // the user's note, shown, searched and readable by the AI (§7, §16)
  confirmedAt: text("confirmed_at"), // user confirmed it, so it leaves "Needs a look" (§6)
  updatedAt: text("updated_at").notNull(), // last edit time, for audit
});

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(), // stable id referenced by transaction tags and trips
    name: text("name").notNull(), // the hand-applied tag, e.g. "Lisbon trip" (§10)
    createdAt: text("created_at").notNull(), // ordering in tag pickers
  },
  (t) => [uniqueIndex("tags_name_uq").on(t.name)],
);

export const transactionTags = sqliteTable(
  "transaction_tags",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id), // tagged transaction
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id), // tag applied; tags take priority over categories in budgets (§10)
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

export const splits = sqliteTable(
  "splits",
  {
    id: text("id").primaryKey(), // stable id; provenance names split parts (§7)
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id), // the original transaction being split (§6)
    amountCents: integer("amount_cents").notNull(), // this part's signed cents; parts add up to the original (§1 invariant)
    category: text("category"), // this part's category (§6)
    necessity: text("necessity", { enum: NECESSITY }), // this part's necessary label (§8)
    note: text("note"), // note on this part (§7)
    position: integer("position").notNull(), // display order of parts
  },
  (t) => [index("splits_transaction_idx").on(t.transactionId)],
);

export const transferLinks = sqliteTable(
  "transfer_links",
  {
    id: text("id").primaryKey(), // stable id for undo and notes on the pair
    outTransactionId: text("out_transaction_id")
      .notNull()
      .references(() => transactions.id), // money leaving one of my accounts (§6)
    inTransactionId: text("in_transaction_id")
      .notNull()
      .references(() => transactions.id), // the matching money arriving in another of my accounts (§6)
    source: text("source", { enum: LINK_SOURCES }).notNull(), // auto-matched or marked by me (decision 005)
    undoneAt: text("undone_at"), // auto match the user undid; stops the matcher re-creating it (§6)
    needsReview: bool("needs_review").notNull().default(false), // one side was removed by Plaid; flagged for review (§4)
    createdAt: text("created_at").notNull(), // when the link was made; newest auto matches are reviewed first (§6)
  },
  (t) => [index("transfer_links_out_idx").on(t.outTransactionId), index("transfer_links_in_idx").on(t.inTransactionId)],
);

export const refundLinks = sqliteTable(
  "refund_links",
  {
    id: text("id").primaryKey(), // stable id for undo
    refundTransactionId: text("refund_transaction_id")
      .notNull()
      .references(() => transactions.id), // the refund (§6)
    purchaseTransactionId: text("purchase_transaction_id")
      .notNull()
      .references(() => transactions.id), // the purchase it reduces, in the purchase's period (decision 005)
    source: text("source", { enum: LINK_SOURCES }).notNull(), // auto-suggested or linked by me
    undoneAt: text("undone_at"), // link the user undid; stops it being re-suggested
    needsReview: bool("needs_review").notNull().default(false), // one side was removed by Plaid (§4)
    createdAt: text("created_at").notNull(), // when the refund was linked, for the action log and review (§6)
  },
  (t) => [index("refund_links_purchase_idx").on(t.purchaseTransactionId)],
);

// =================================================================== merchants & rules

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(), // one merchant group, e.g. "Amazon" (§7)
  name: text("name").notNull(), // display name of the group (§7)
  createdAt: text("created_at").notNull(), // when the group was created, to show newly merged merchants (§7)
});

export const merchantAliases = sqliteTable(
  "merchant_aliases",
  {
    id: text("id").primaryKey(), // stable id for merge/separate undo
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id), // the group this alias belongs to (§7)
    matchKey: text("match_key").notNull(), // normalised merchant entity id / name / description that maps to the group (§7)
    source: text("source", { enum: LINK_SOURCES }).notNull(), // grouped automatically or merged by me (§7)
  },
  (t) => [uniqueIndex("merchant_aliases_key_uq").on(t.matchKey)],
);

export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(), // stable id; the action log and undo refer to the rule by it (§6)
  position: integer("position").notNull(), // rules apply in order (decision 005)
  matchKind: text("match_kind", { enum: RULE_MATCH_KINDS }).notNull(), // match on merchant group or on description text (payer/payee) (§6)
  matchValue: text("match_value").notNull(), // the merchant id or text to match (§6)
  accountId: text("account_id").references(() => accounts.id), // optional: only for this account
  setCategory: text("set_category"), // "always this category for this merchant" (§6)
  setBucket: text("set_bucket", { enum: BUCKETS }), // always transfer / Poker / income / spending (§6)
  setNecessity: text("set_necessity", { enum: NECESSITY }), // always necessary / not necessary (§8)
  enabled: bool("enabled").notNull().default(true), // turn a rule off without losing it
  createdAt: text("created_at").notNull(), // when the rule was added, shown in the rules list (§6)
});

export const necessaryLabels = sqliteTable(
  "necessary_labels",
  {
    id: text("id").primaryKey(), // stable id; the action log and undo refer to the label by it (§8)
    targetKind: text("target_kind", { enum: LABEL_TARGET_KINDS }).notNull(), // labels a category or a merchant (§8)
    targetValue: text("target_value").notNull(), // the category key or merchant id (§8)
    necessity: text("necessity", { enum: NECESSITY }).notNull(), // necessary / not necessary; absence means "not set" (§8)
  },
  (t) => [uniqueIndex("necessary_labels_target_uq").on(t.targetKind, t.targetValue)],
);

export const cuttingBack = sqliteTable("cutting_back", {
  id: text("id").primaryKey(), // stable id; the cutting-back list and undo refer to it (§8)
  targetKind: text("target_kind", { enum: LABEL_TARGET_KINDS }).notNull(), // a category or merchant I'm cutting back on (§8)
  targetValue: text("target_value").notNull(), // the category key or merchant id (§8)
  startedOn: text("started_on").notNull(), // compare months before and after starting (§8)
  endedOn: text("ended_on"), // when I stopped tracking it
});

// =================================================================== budgets

export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(), // stable id; parts, amounts and the budget window refer to it (§10)
  name: text("name").notNull(), // shown on the budget window (§10)
  periodKind: text("period_kind", { enum: BUDGET_PERIOD_KINDS }).notNull(), // weekly/biweekly/monthly/yearly/custom (decision 004)
  anchorDate: text("anchor_date").notNull(), // first day of the first period; aligns weekly/biweekly/custom periods (§10)
  customEndDate: text("custom_end_date"), // end of a custom-dates budget (§10)
  archivedAt: text("archived_at"), // stopped using it; history stays viewable
  createdAt: text("created_at").notNull(), // when the budget was created; the first period starts no earlier (§10)
});

export const budgetAmounts = sqliteTable(
  "budget_amounts",
  {
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id), // which budget
    effectiveFrom: text("effective_from").notNull(), // overall amount applies from this period on (keeps past plans for planned vs actual, §10)
    amountCents: integer("amount_cents").notNull(), // the overall spending budget per period (§10)
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.effectiveFrom] })],
);

export const budgetParts = sqliteTable(
  "budget_parts",
  {
    id: text("id").primaryKey(), // stable id; targets and the history grid refer to the part (§10)
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id), // the budget this part sits inside (§10)
    name: text("name").notNull(), // e.g. "Eating out" (§10)
    expectedCents: integer("expected_cents").notNull(), // expected spend per period (§10)
    effectiveFrom: text("effective_from").notNull(), // part applies from this period (parts carry over until changed, §10)
    effectiveTo: text("effective_to"), // last day it applied; null while current (history grid, §10)
    position: integer("position").notNull(), // display order
  },
  (t) => [index("budget_parts_budget_idx").on(t.budgetId)],
);

export const budgetPartTargets = sqliteTable(
  "budget_part_targets",
  {
    partId: text("part_id")
      .notNull()
      .references(() => budgetParts.id), // the part this category/merchant/tag belongs to (§10)
    targetKind: text("target_kind", { enum: BUDGET_PART_TARGET_KINDS }).notNull(), // part is defined by categories, merchants or a tag (§10)
    targetValue: text("target_value").notNull(), // category key, merchant id or tag id (§10)
  },
  (t) => [primaryKey({ columns: [t.partId, t.targetKind, t.targetValue] })],
);

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(), // stable id; the trip bar and its drill-down refer to it (§10)
  tagId: text("tag_id")
    .notNull()
    .references(() => tags.id), // transactions tagged with this belong to the trip (§10)
  name: text("name").notNull(), // e.g. "Lisbon trip" (§10)
  startDate: text("start_date").notNull(), // trips have their own dates, can span months (§10)
  endDate: text("end_date").notNull(), // end of the trip's pace bar (§10)
  expectedCents: integer("expected_cents").notNull(), // one expected total for the whole trip (§10)
});

// =================================================================== goals

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(), // stable id; the goal's picture lives on the Mac under this id (§11)
  name: text("name").notNull(), // e.g. "DGX Spark" (§11)
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id), // each goal is funded from exactly one account (decision 004)
  targetCents: integer("target_cents").notNull(), // amount to save (§11)
  priority: integer("priority").notNull(), // funding order, 1 = first (decision 004)
  deadline: text("deadline"), // optional target date for "need $X/month" (§11)
  expectedContributionCents: integer("expected_contribution_cents"), // optional planned contribution per period (§11)
  contributionPeriod: text("contribution_period", { enum: CONTRIBUTION_PERIODS }), // period of that contribution (§11)
  colorSlot: integer("color_slot").notNull(), // keeps the goal's colour the same everywhere (§15)
  completedAt: text("completed_at"), // reached; triggers the big celebration once (§11)
  archivedAt: text("archived_at"), // archived as an achievement (§11)
  purchaseTransactionId: text("purchase_transaction_id").references(() => transactions.id), // optional link to the purchase (§11)
  createdAt: text("created_at").notNull(), // audit and ordering
});

export const goalMilestonesSeen = sqliteTable(
  "goal_milestones_seen",
  {
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id), // which goal
    milestoneCents: integer("milestone_cents").notNull(), // milestone amount already celebrated, so each plays once (§11)
    seenAt: text("seen_at").notNull(), // when it was celebrated
  },
  (t) => [primaryKey({ columns: [t.goalId, t.milestoneCents] })],
);

// =================================================================== recurring & liabilities

export const recurringItems = sqliteTable(
  "recurring_items",
  {
    id: text("id").primaryKey(), // stable id; overrides and the calendar refer to the item (§9)
    plaidStreamId: text("plaid_stream_id"), // Plaid recurring stream id, to update it on each sync; null for ones I added (§9)
    source: text("source", { enum: LINK_SOURCES }).notNull(), // detected by Plaid (auto) or added by me (manual) (§9)
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id), // the account it comes from, for the upcoming view (§9)
    direction: text("direction", { enum: RECURRING_DIRECTIONS }).notNull(), // charge or income (§9)
    description: text("description").notNull(), // name shown in the list and calendar (§9)
    merchantName: text("merchant_name"), // merchant shown alongside (§9)
    category: text("category"), // category for the fixed-costs total (§9)
    frequency: text("frequency", { enum: RECURRING_FREQUENCIES }).notNull(), // how often, for projecting next dates (§9)
    averageAmountCents: integer("average_amount_cents").notNull(), // estimate for variable bills (§9)
    lastAmountCents: integer("last_amount_cents"), // latest amount; a change from before is a price change (§9)
    lastDate: text("last_date"), // last occurrence (§9)
    predictedNextDate: text("predicted_next_date"), // next expected date for the upcoming view and calendar (§9)
    isActive: bool("is_active").notNull().default(true), // Plaid says the stream is still active (§9)
    plaidStatus: text("plaid_status"), // MATURE / EARLY_DETECTION / TOMBSTONED; early ones are listed quietly as new (§9)
    firstSeenOn: text("first_seen_on").notNull(), // when we first saw it, to list new charges (§8 Worth a look, §9)
  },
  (t) => [uniqueIndex("recurring_items_stream_uq").on(t.plaidStreamId)],
);

export const recurringOverrides = sqliteTable("recurring_overrides", {
  recurringItemId: text("recurring_item_id")
    .primaryKey()
    .references(() => recurringItems.id), // the item I edited (§9)
  name: text("name"), // my name for it (§9)
  amountCents: integer("amount_cents"), // my corrected amount (§9)
  nextDate: text("next_date"), // my corrected next date (§9)
  accountId: text("account_id").references(() => accounts.id), // my corrected paying account (§9)
  frequency: text("frequency", { enum: RECURRING_FREQUENCIES }), // my corrected frequency (§9)
  removed: bool("removed").notNull().default(false), // I removed it; kept so sync doesn't bring it back (§9)
  updatedAt: text("updated_at").notNull(), // when I last edited it; newer Plaid data doesn't overwrite my edit (§9)
});

export const recurringItemTransactions = sqliteTable(
  "recurring_item_transactions",
  {
    recurringItemId: text("recurring_item_id")
      .notNull()
      .references(() => recurringItems.id), // the recurring item
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id), // a past occurrence; projections show what they're based on (§9)
  },
  (t) => [primaryKey({ columns: [t.recurringItemId, t.transactionId] })],
);

export const liabilities = sqliteTable("liabilities", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id), // the credit card or loan account (§9)
  lastStatementBalanceCents: integer("last_statement_balance_cents"), // amount due on the statement, an upcoming payment (§9)
  lastStatementIssueDate: text("last_statement_issue_date"), // which statement that is (§9)
  nextPaymentDueDate: text("next_payment_due_date"), // when the card payment is due (§9)
  minimumPaymentCents: integer("minimum_payment_cents"), // shown with the due payment (§9)
  payingAccountId: text("paying_account_id").references(() => accounts.id), // the account I pay the card from, chosen by me (§9)
  updatedAt: text("updated_at").notNull(), // when Liabilities data was last fetched (§4)
});

// =================================================================== investments

export const securities = sqliteTable(
  "securities",
  {
    id: text("id").primaryKey(), // our stable id
    plaidSecurityId: text("plaid_security_id").notNull(), // matches holdings and investment transactions in Plaid responses (§17)
    name: text("name"), // holding name (§17)
    tickerSymbol: text("ticker_symbol"), // ticker shown in holdings (§17)
    type: text("type"), // equity / etf / mutual fund / cash… for the allocation breakdown (§17)
  },
  (t) => [uniqueIndex("securities_plaid_security_id_uq").on(t.plaidSecurityId)],
);

export const holdings = sqliteTable(
  "holdings",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id), // the investment account (§17)
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id), // what is held (§17)
    asOfDate: text("as_of_date").notNull(), // one row per day synced: holdings history from the day connected (§17)
    quantity: real("quantity").notNull(), // share count (not money, may be fractional), shown in holdings (§17)
    valueCents: integer("value_cents").notNull(), // current value, share of the account and allocation (§17)
    isoCurrencyCode: text("iso_currency_code"), // guards against summing non-USD values as dollars
  },
  (t) => [primaryKey({ columns: [t.accountId, t.securityId, t.asOfDate] })],
);

export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    id: text("id").primaryKey(), // stable id for notes and drill-down
    plaidInvestmentTransactionId: text("plaid_investment_transaction_id"), // dedupes repeated syncs (§4)
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id), // the investment account (§17)
    securityId: text("security_id").references(() => securities.id), // the security bought/sold, if any (§17)
    date: text("date").notNull(), // activity list and dividend income by period (§17)
    type: text("type").notNull(), // buy / sell / cash / fee / transfer (§17)
    subtype: text("subtype"), // e.g. dividend, interest, contribution: dividends are income (§6, §17)
    amountCents: integer("amount_cents").notNull(), // signed cents, positive = into the account's cash (§17)
    quantity: real("quantity"), // shares bought/sold (not money), shown in activity (§17)
    feesCents: integer("fees_cents"), // fees shown in activity (§17)
    rawDescription: text("raw_description").notNull(), // Plaid's description, shown in activity (§17)
    note: text("note"), // my note on the activity (§7, §17)
  },
  (t) => [uniqueIndex("investment_transactions_plaid_id_uq").on(t.plaidInvestmentTransactionId)],
);

// =================================================================== snapshots

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id), // whose balance (§5)
    date: text("date").notNull(), // the day; daily for 90 days, then weekly (§5)
    balanceCents: integer("balance_cents").notNull(), // net-worth contribution that day (debts negative); net worth = sum (§5)
    source: text("source", { enum: SNAPSHOT_SOURCES }).notNull(), // Plaid / rebuilt / manual / carried forward, shown in charts (§5)
    isEstimated: bool("is_estimated").notNull().default(false), // rebuilt history, drawn as estimated (§5)
    isCarriedForward: bool("is_carried_forward").notNull().default(false), // missed day filled with the last known balance, marked (§5)
  },
  (t) => [primaryKey({ columns: [t.accountId, t.date] })],
);

// =================================================================== system (not part of CoreData)

export const appCredentials = sqliteTable(
  "app_credentials",
  {
    id: text("id").primaryKey(), // stable id, shown when revoking (§2)
    tokenHash: text("token_hash").notNull(), // HMAC-SHA256(APP_TOKEN_PEPPER, token) hex; the token itself is never stored (§2)
    label: text("label").notNull(), // which device/session it was issued to, e.g. "MacBook" (§2 revoke)
    createdAt: text("created_at").notNull(), // issue time
    expiresAt: text("expires_at"), // after this the app must sign in with Google again (§2)
    lastUsedAt: text("last_used_at"), // helps decide what to revoke (§2)
    revokedAt: text("revoked_at"), // revoked credentials stop working immediately (§2)
  },
  (t) => [uniqueIndex("app_credentials_token_hash_uq").on(t.tokenHash)],
);

export const LINK_SESSION_MODES = ["new", "update"] as const;
export const LINK_SESSION_STATUSES = ["pending", "finalizing", "duplicate", "done", "cancelled", "failed"] as const;

export const linkSessions = sqliteTable(
  "link_sessions",
  {
    id: text("id").primaryKey(), // our session id; the redirect page and the app's deep link carry it, never a Plaid token (§3)
    linkToken: text("link_token").notNull(), // Plaid link token (expires within hours, useless without our Plaid secret); needed for /link/token/get to collect the result (§3)
    mode: text("mode", { enum: LINK_SESSION_MODES }).notNull(), // new bank or update mode for a reconnect (§3, §4)
    itemId: text("item_id").references(() => plaidItems.id), // the connection being repaired in update mode (§4); for new banks, the item created once finished
    status: text("status", { enum: LINK_SESSION_STATUSES }).notNull(), // pending → done / cancelled / failed / duplicate (awaiting my choice); nothing is half-saved (§3)
    errorCode: text("error_code"), // why it failed or was cancelled, shown so I can try again (§3)
    pendingAccessTokenEnc: text("pending_access_token_enc"), // AES-GCM ciphertext (TOKEN_ENC_KEY) held only while I decide about a duplicate bank; cleared after (§3)
    pendingResultJson: text("pending_result_json"), // trimmed item + accounts (no identity) awaiting the duplicate decision (§3)
    expiresAt: text("expires_at").notNull(), // link token expiry; later lookups are refused (§3)
    createdAt: text("created_at").notNull(), // when Link was opened
    finishedAt: text("finished_at"), // when the outcome was recorded (§3 import status)
  },
  (t) => [uniqueIndex("link_sessions_link_token_uq").on(t.linkToken)],
);

export const actionLog = sqliteTable(
  "action_log",
  {
    id: text("id").primaryKey(), // stable id used by the undo endpoint (§16)
    actionName: text("action_name").notNull(), // registry action that was applied (§16)
    inputJson: text("input_json").notNull(), // the validated input, so the log shows what was asked (§16)
    summary: text("summary").notNull(), // before → after summary shown in the log (§16)
    mutationsJson: text("mutations_json").notNull(), // row changes applied, for audit (§16)
    inverseJson: text("inverse_json").notNull(), // row changes that undo it (§16 "can be undone")
    source: text("source", { enum: ACTION_SOURCES }).notNull(), // made by me in the UI or approved from the AI (§16)
    appliedAt: text("applied_at").notNull(), // when it was applied
    undoneAt: text("undone_at"), // when it was undone; an action is undone at most once
  },
  (t) => [index("action_log_applied_idx").on(t.appliedAt)],
);

export const aiRateCounters = sqliteTable("ai_rate_counters", {
  bucket: text("bucket").primaryKey(), // window key, e.g. "rpm:2026-11-18T10:01" / "rpd:2026-11-18" / "cooldown" (§16 free-tier limits)
  count: integer("count").notNull().default(0), // Gemini requests made in that window (§16)
  resetAt: text("reset_at").notNull(), // when the window ends or the 429 retryDelay expires: "available again at …" (§16)
});

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(), // stable id; the Refresh button polls this run for progress (§4)
    itemId: text("item_id").references(() => plaidItems.id), // the bank synced; one failing doesn't stop others (§4)
    trigger: text("trigger", { enum: ["cron", "webhook", "manual", "initial"] }).notNull(), // daily job, webhook, Refresh button or first import (§4)
    startedAt: text("started_at").notNull(), // progress and "Importing…" status (§3, §4)
    finishedAt: text("finished_at"), // null while running (§3 import status)
    status: text("status", { enum: ["running", "ok", "error"] }).notNull(), // "Up to date" or the specific error (§4)
    errorCode: text("error_code"), // the specific error shown after Refresh (§4)
    addedCount: integer("added_count").notNull().default(0), // transactions added, for sync debugging
    modifiedCount: integer("modified_count").notNull().default(0), // transactions modified, for sync debugging
    removedCount: integer("removed_count").notNull().default(0), // transactions removed, for sync debugging
  },
  (t) => [index("sync_runs_item_idx").on(t.itemId, t.startedAt)],
);
