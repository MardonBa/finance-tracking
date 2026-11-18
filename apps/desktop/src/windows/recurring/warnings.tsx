/**
 * Below-zero warnings (§9): "which account, how much short, and on what date".
 * Shown at the top of the Recurring window, and exported for the Overview:
 *
 *   import { LowBalanceWarnings, useLowBalanceWarnings } from "../recurring/warnings.tsx";
 *   const { warnings } = useLowBalanceWarnings();            // data only
 *   <LowBalanceWarnings onOpen={() => open("recurring")} />  // ready-made banner (renders nothing when all is fine)
 *
 * Both read the `recurring.upcoming` registry query, so the Overview and the
 * Recurring window always agree. There's no low-balance buffer: only a
 * projected balance below zero warns.
 */
import { useQuery } from "../../data/hooks.ts";
import { Button } from "../../ui/components.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { longDate, money } from "../shared/format.ts";
import type { BelowZeroWarning, UpcomingValue } from "./types.ts";
import "../shared/shared.css";

export type { BelowZeroWarning };

export interface LowBalanceWarningsState {
  warnings: BelowZeroWarning[];
  loading: boolean;
  error: Error | undefined;
}

export function useLowBalanceWarnings(): LowBalanceWarningsState {
  const q = useQuery<UpcomingValue>("recurring.upcoming", {});
  return { warnings: q.data?.value.warnings ?? [], loading: q.loading, error: q.error };
}

/** One sentence per warning: "Checking is projected to be $120.00 short on Nov 3, 2026." */
export function warningSentence(w: BelowZeroWarning): string {
  const lowest = w.lowestDate !== w.date ? ` (lowest on ${longDate(w.lowestDate)})` : "";
  return `${w.accountName} is projected to be ${money(w.shortfallCents)} short on ${longDate(w.date)}${lowest}.`;
}

export interface LowBalanceWarningsViewProps {
  warnings: readonly BelowZeroWarning[];
  /** Shows a "See what's coming" button (e.g. the Overview opening Recurring). */
  onOpen?: () => void;
}

export function LowBalanceWarningsView({ warnings, onOpen }: LowBalanceWarningsViewProps) {
  if (warnings.length === 0) return null;
  return (
    <div className="rti-banner" role="alert" data-testid="low-balance-warning">
      <Icon name="warning" size={20} className="rti-banner__icon" />
      <div style={{ flex: 1 }}>
        <p className="rti-banner__title">{warnings.length === 1 ? "A balance is projected to go below zero" : `${warnings.length} balances are projected to go below zero`}</p>
        <ul className="rti-banner__list">
          {warnings.map((w) => (
            <li key={w.accountId}>{warningSentence(w)}</li>
          ))}
        </ul>
      </div>
      {onOpen && (
        <Button size="sm" onClick={onOpen}>
          See what's coming
        </Button>
      )}
    </div>
  );
}

/** Self-loading banner for the Overview; renders nothing while loading or when every account is covered. */
export function LowBalanceWarnings({ onOpen }: { onOpen?: () => void }) {
  const { warnings } = useLowBalanceWarnings();
  return <LowBalanceWarningsView warnings={warnings} onOpen={onOpen} />;
}
