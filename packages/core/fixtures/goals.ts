/**
 * Hand-built goals fixture (§11): the basic fixture ("today" 2026-10-31)
 * plus three goals on the HYSA (protected $5,000, balance $10,512.34), daily
 * balance snapshots and a $300 withdrawal on Oct 20.
 *
 * - Bike ($1,200, priority 1): complete, its completion not yet celebrated.
 * - DGX Spark ($6,000, priority 2, deadline 2027-06-01, $300/month expected):
 *   $4,312.34 saved; milestones up to $3,900 already celebrated, so $4,200
 *   is the one new milestone.
 * - Trip ($3,000, priority 3): nothing assigned yet.
 * - An archived "Headphones" achievement linked to its purchase.
 */
import type { IsoDate } from "../src/dates.ts";
import { eachDay } from "../src/dates.ts";
import type { BalanceSnapshot, CoreData, Goal, Transaction } from "../src/types.ts";
import { basicFixture } from "./index.ts";

export interface GoalsFixture {
  today: IsoDate;
  data: CoreData;
}

const T0 = "2026-08-01T00:00:00.000Z";

function goal(over: Partial<Goal> & Pick<Goal, "id" | "name" | "targetCents" | "priority" | "colorSlot">): Goal {
  return {
    accountId: "acc_hysa",
    deadline: null,
    expectedContributionCents: null,
    contributionPeriod: null,
    completedAt: null,
    archivedAt: null,
    purchaseTransactionId: null,
    createdAt: T0,
    ...over,
  };
}

function snap(date: IsoDate, balanceCents: number): BalanceSnapshot {
  return { accountId: "acc_hysa", date, balanceCents, source: "plaid", isEstimated: false, isCarriedForward: false };
}

export function goalsFixture(): GoalsFixture {
  const { today, data } = basicFixture();
  data.goals = [
    goal({ id: "goal_bike", name: "Bike", targetCents: 120000, priority: 1, colorSlot: 0 }),
    goal({
      id: "goal_dgx",
      name: "DGX Spark",
      targetCents: 600000,
      priority: 2,
      colorSlot: 1,
      deadline: "2027-06-01",
      expectedContributionCents: 30000,
      contributionPeriod: "monthly",
    }),
    goal({ id: "goal_trip", name: "Trip", targetCents: 300000, priority: 3, colorSlot: 2 }),
    goal({
      id: "goal_headphones",
      name: "Headphones",
      targetCents: 12999,
      priority: 1,
      colorSlot: 3,
      completedAt: "2026-10-08T00:00:00.000Z",
      archivedAt: "2026-10-09T00:00:00.000Z",
      purchaseTransactionId: "tx_card_purchase_amazon",
    }),
  ];
  // Every DGX milestone below $4,200 was celebrated before.
  data.goalMilestonesSeen = [30000, 60000, 90000, 120000, 150000, 180000, 210000, 240000, 270000, 300000, 330000, 360000, 390000].map((c) => ({
    goalId: "goal_dgx",
    milestoneCents: c,
    seenAt: "2026-10-01T00:00:00.000Z",
  }));
  // HYSA grows ~$22/day to $10,812.34 by Oct 19, then a $300 withdrawal on Oct 20.
  const days = eachDay("2026-08-01", "2026-10-30");
  data.balanceSnapshots.push(
    ...days.map((d, i) => (d < "2026-10-20" ? snap(d, 900000 + Math.round((181234 * i) / 79)) : snap(d, 1051234))),
  );
  const withdrawal: Transaction = {
    ...data.transactions.find((t) => t.id === "tx_transfer_in_hysa")!,
    id: "tx_hysa_withdrawal",
    plaidTransactionId: "p_hysa_withdrawal",
    amountCents: -30000,
    date: "2026-10-20",
    authorizedDate: "2026-10-20",
    rawDescription: "ONLINE TRANSFER TO CHK XXXX0000",
    plaidCategoryPrimary: "TRANSFER_OUT",
    plaidCategoryDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    createdAt: "2026-10-20T06:00:00.000Z",
    updatedAt: "2026-10-20T06:00:00.000Z",
  };
  data.transactions.push(withdrawal);
  return { today, data };
}
