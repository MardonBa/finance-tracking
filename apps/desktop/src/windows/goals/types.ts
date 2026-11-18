/** Shapes of the goal queries' values (packages/core/src/queries/goals). */
import type { ContributionPeriod, Goals, IsoDate } from "@ft/core";

export interface GoalCardValue {
  goalId: string;
  name: string;
  accountId: string;
  accountName: string;
  priority: number;
  colorSlot: number;
  savedCents: number;
  targetCents: number;
  percent: number;
  completedAt: string | null;
  createdAt: string;
  plan: { deadline: IsoDate | null; expectedContributionCents: number | null; contributionPeriod: ContributionPeriod | null };
  recentMonthlyRateCents: number | null;
  accountMonthlyRateCents: number | null;
  deadline: Goals.DeadlineStatus | null;
  contributions: Goals.PeriodContribution[] | null;
  projection: Goals.GoalProjection & { showBoth: boolean; label: string };
  milestones: (Goals.Milestone & { celebrated: boolean; reached: boolean })[];
  accountWarning: string | null;
}

export interface Achievement {
  goalId: string;
  name: string;
  targetCents: number;
  completedAt: string | null;
  archivedAt: string | null;
  colorSlot: number;
  purchase: { transactionId: string; date: IsoDate; amountCents: number; name: string } | null;
}

export interface GoalsListValue {
  goals: GoalCardValue[];
  achievements: Achievement[];
}

export interface AccountBarsValue {
  accounts: { accountId: string; accountName: string; balanceCents: number; totalCents: number; segments: Goals.BarSegment[]; warning: string | null }[];
}

export interface WhatIfValue {
  accountId: string;
  found: boolean;
  result: Goals.WhatIfResult | null;
}

export interface CelebrationItem extends Goals.Milestone {
  goalId: string;
  name: string;
}

export interface CelebrationsValue {
  pending: CelebrationItem[];
  hasCompletion: boolean;
}

export interface ExplainValue {
  accountId: string;
  since: IsoDate;
  balanceKnown: boolean;
  changes: Goals.GoalChange[];
}
