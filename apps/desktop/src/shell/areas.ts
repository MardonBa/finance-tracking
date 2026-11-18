/**
 * The nine areas of the desktop (§14), in dock and ⌘1–⌘9 order. Each area
 * has at most one window.
 */
import type { IconName } from "../ui/Icon.tsx";

export const AREAS = [
  "overview",
  "spending",
  "budgets",
  "goals",
  "recurring",
  "trajectory",
  "investments",
  "transactions",
  "assistant",
] as const;

export type AreaId = (typeof AREAS)[number];

export interface Size {
  w: number;
  h: number;
}

export interface AreaInfo {
  id: AreaId;
  title: string;
  icon: IconName;
  /** The one main question the window answers (§15 "uncluttered"). */
  question: string;
  defaultSize: Size;
  minSize: Size;
}

const base = { defaultSize: { w: 760, h: 520 }, minSize: { w: 360, h: 240 } };

export const AREA_INFO: Record<AreaId, AreaInfo> = {
  overview: { id: "overview", title: "Overview", icon: "overview", question: "Where do I stand today?", ...base, defaultSize: { w: 780, h: 540 } },
  spending: { id: "spending", title: "Spending", icon: "spending", question: "Where is my money going?", ...base },
  budgets: { id: "budgets", title: "Budgets", icon: "budgets", question: "Am I on budget this month?", ...base },
  goals: { id: "goals", title: "Goals", icon: "goals", question: "How funded is each goal, and when will it be reached?", ...base },
  recurring: { id: "recurring", title: "Recurring", icon: "recurring", question: "What's coming out of my accounts soon?", ...base },
  trajectory: { id: "trajectory", title: "Trajectory", icon: "trajectory", question: "Where is my net worth heading?", ...base },
  investments: { id: "investments", title: "Investments", icon: "investments", question: "How are my investments doing?", ...base },
  transactions: {
    id: "transactions",
    title: "Transactions",
    icon: "transactions",
    question: "What exactly did I spend and earn?",
    ...base,
    defaultSize: { w: 840, h: 560 },
  },
  assistant: {
    id: "assistant",
    title: "AI Assistant",
    icon: "assistant",
    question: "How can I manage my money better?",
    defaultSize: { w: 460, h: 600 },
    minSize: { w: 320, h: 320 },
  },
};

export function isAreaId(v: unknown): v is AreaId {
  return typeof v === "string" && (AREAS as readonly string[]).includes(v);
}

/** "⌘1" … "⌘9" for the area's dock position. */
export function shortcutFor(area: AreaId): string {
  return `⌘${AREAS.indexOf(area) + 1}`;
}
