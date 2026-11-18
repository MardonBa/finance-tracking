/** Shapes of the registry query values the Trajectory window reads (from @ft/core). */
import type { Balances, Trajectory } from "@ft/core";

export type NetWorthChart = Balances.NetWorthChart;
export type ProjectionResult = Trajectory.ProjectionResult & { assumptions: Trajectory.TrajectoryBaseAssumptions };
export type BaseAssumptions = Trajectory.TrajectoryBaseAssumptions;
export type ParsedLifePhase = Trajectory.ParsedLifePhase;
export type LifePhaseFields = Trajectory.LifePhaseFields;
export type EarningRow = Trajectory.EarningVsSpendingRow;

export interface AssumptionsValue {
  assumptions: BaseAssumptions;
  isDefault: boolean;
  phases: ParsedLifePhase[];
}

export interface MonthTotals {
  month: string;
  incomeCents: number;
  spendingCents: number;
  savedCents: number;
  savingsRate: number | null;
}

export interface InvestmentGrowthValue {
  accounts: Array<{
    accountId: string;
    accountName: string;
    historyStartsOn: string | null;
    startingValueCents: number;
    points: Trajectory.GrowthPoint[];
  }>;
}

export interface InterestValue {
  accounts: Array<Trajectory.InterestVsPrincipal & { accountName: string }>;
}

export type Grain = "month" | "year";
