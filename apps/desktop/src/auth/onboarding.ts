/**
 * First-run steps after "Set up Touch ID" (§3 step 3 onwards). Phase 2's
 * onboarding track adds the "add banks" step in its own file:
 *
 *   // src/onboarding/add-banks.tsx
 *   import { defineOnboardingStep } from "../auth/onboarding";
 *   export default defineOnboardingStep({ id: "add-banks", order: 10, component: AddBanks });
 *
 * Steps run in `order`, each calling `done()` to continue; after the last
 * one the desktop opens. A step with id "add-banks" is also what the
 * Overview's "Add a bank" button (ShellActions.addBanks) opens later.
 */
import type { ComponentType } from "react";

export interface OnboardingStepProps {
  /** The app credential, for API calls. */
  token: string;
  /** Continue to the next step (or the desktop). */
  done: () => void;
}

export interface OnboardingStep {
  id: string;
  /** Lower runs first. */
  order: number;
  component: ComponentType<OnboardingStepProps>;
}

export function defineOnboardingStep(step: OnboardingStep): OnboardingStep {
  return step;
}

export function collectSteps(modules: Record<string, unknown>): OnboardingStep[] {
  return Object.values(modules)
    .map((m) => (m as { default?: OnboardingStep }).default)
    .filter((s): s is OnboardingStep => !!s && typeof s.id === "string" && !!s.component)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export const ONBOARDING_STEPS: OnboardingStep[] = collectSteps(import.meta.glob("../onboarding/*.tsx", { eager: true }));

export const ADD_BANKS_STEP_ID = "add-banks";
