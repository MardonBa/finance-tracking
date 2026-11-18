/**
 * Placeholder window contents, one per area, until Phase 2 registers the
 * real windows (registry.ts). Each is a proper empty state: what goes here
 * and the next step (§15).
 */
import type { ComponentType } from "react";
import { EmptyState } from "../ui/components.tsx";
import type { IconName } from "../ui/Icon.tsx";
import { AREA_INFO, AREAS, type AreaId } from "./areas.ts";
import { useWindow } from "./context.ts";

interface Copy {
  title: string;
  description: string;
  action: string;
  icon?: IconName;
  /** "banks" starts the add-a-bank flow; an area opens that area. */
  next: "banks" | AreaId;
}

const COPY: Record<AreaId, Copy> = {
  overview: {
    title: "No accounts yet",
    description: "Your net worth, balances, budgets and goals show up here once a bank is connected.",
    action: "Add a bank",
    icon: "plus",
    next: "banks",
  },
  spending: {
    title: "No spending yet",
    description: "Where your money goes, by category and merchant, appears after your first transactions import.",
    action: "Add a bank",
    icon: "plus",
    next: "banks",
  },
  budgets: {
    title: "No budgets yet",
    description: "Set a monthly budget per category and see whether you're on pace.",
    action: "See your spending first",
    next: "spending",
  },
  goals: {
    title: "No goals yet",
    description: "Savings goals show how funded each one is and when it will be reached.",
    action: "Open the Overview",
    next: "overview",
  },
  recurring: {
    title: "No recurring charges found",
    description: "Subscriptions and bills are detected from a few months of transactions.",
    action: "Add a bank",
    icon: "plus",
    next: "banks",
  },
  trajectory: {
    title: "No history yet",
    description: "Net worth over time and where it's heading, built from daily balance snapshots.",
    action: "Add a bank",
    icon: "plus",
    next: "banks",
  },
  investments: {
    title: "No investment accounts",
    description: "Holdings, allocation and performance appear when a brokerage or retirement account is connected.",
    action: "Add a bank",
    icon: "plus",
    next: "banks",
  },
  transactions: {
    title: "No transactions yet",
    description: "Every transaction from your connected accounts, searchable and fixable, lands here.",
    action: "Add a bank",
    icon: "plus",
    next: "banks",
  },
  assistant: {
    title: "Ask about your money",
    description: "The assistant answers questions using your own data. It only runs when you ask.",
    action: "Open the Overview",
    next: "overview",
  },
};

function makePlaceholder(area: AreaId): ComponentType {
  const copy = COPY[area];
  function Placeholder() {
    const w = useWindow();
    return (
      <div className="wm-placeholder">
        <EmptyState
          icon={AREA_INFO[area].icon}
          title={copy.title}
          description={copy.description}
          action={{ label: copy.action, icon: copy.icon, onClick: () => (copy.next === "banks" ? w.addBanks() : w.open(copy.next)) }}
        />
      </div>
    );
  }
  Placeholder.displayName = `${AREA_INFO[area].title}Placeholder`;
  return Placeholder;
}

export const PLACEHOLDERS = Object.fromEntries(AREAS.map((a) => [a, makePlaceholder(a)])) as Record<AreaId, ComponentType>;
