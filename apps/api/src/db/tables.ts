/**
 * Maps every @ft/core CoreData slice to its D1 table, so registry Mutations
 * (which name slices) can be executed and slices can be loaded for queries.
 */
import type { DataKey } from "@ft/core";
import * as s from "./schema.ts";

export const TABLES = {
  items: s.plaidItems,
  accounts: s.accounts,
  transactions: s.transactions,
  overrides: s.overrides,
  tags: s.tags,
  transactionTags: s.transactionTags,
  splits: s.splits,
  transferLinks: s.transferLinks,
  refundLinks: s.refundLinks,
  merchants: s.merchants,
  merchantAliases: s.merchantAliases,
  rules: s.rules,
  necessaryLabels: s.necessaryLabels,
  cuttingBack: s.cuttingBack,
  budgets: s.budgets,
  budgetAmounts: s.budgetAmounts,
  budgetParts: s.budgetParts,
  budgetPartTargets: s.budgetPartTargets,
  trips: s.trips,
  goals: s.goals,
  goalMilestonesSeen: s.goalMilestonesSeen,
  recurringItems: s.recurringItems,
  recurringOverrides: s.recurringOverrides,
  recurringItemTransactions: s.recurringItemTransactions,
  liabilities: s.liabilities,
  securities: s.securities,
  holdings: s.holdings,
  investmentTransactions: s.investmentTransactions,
  balanceSnapshots: s.balanceSnapshots,
  trajectoryAssumptions: s.trajectoryAssumptions,
  lifePhases: s.lifePhases,
} as const satisfies Record<DataKey, unknown>;

/**
 * Columns that exist in D1 but must never leave the backend: not loaded into
 * CoreData (so never reach queries, the UI or the AI), and never writable by
 * registry actions.
 */
export const SECRET_COLUMNS: Partial<Record<DataKey, readonly string[]>> = {
  items: ["accessTokenEnc", "transactionsCursor", "transactionsUpdateStatus", "refreshAvailableAt"],
};
