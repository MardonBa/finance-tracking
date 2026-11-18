/**
 * Goal card (§11, design.md §5): the picture prominently next to a progress
 * ring, then "Am I on track?": deadline need and ahead/behind, expected vs
 * actual contributions, projected completion (both dates when later than the
 * deadline), and why the goal lost money.
 */
import type { Goals } from "@ft/core";
import { Button, StatusLabel } from "../../ui/components.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { openDrillDown } from "../../data/drilldown.ts";
import { usd } from "../budgets/format.ts";
import { GoalPicture } from "./GoalPicture.tsx";
import { ProgressRing } from "./ProgressRing.tsx";
import { goalColor } from "./goalColors.ts";
import type { GoalCardValue } from "./types.ts";

export interface GoalCardProps {
  goal: GoalCardValue;
  /** This goal's entry from goals.explainChanges, when it changed. */
  change?: Goals.GoalChange;
  /** For the loss drill-down (goals.explainChanges params). */
  explainParams?: { accountId: string; since: string };
  highlighted?: boolean;
  onEdit: () => void;
  onArchive: () => void;
}

export function GoalCard({ goal: g, change, explainParams, highlighted, onEdit, onArchive }: GoalCardProps) {
  const color = goalColor(g.colorSlot);
  const complete = g.savedCents >= g.targetCents;
  // A funded goal needs no more contributions; unknown periods (no balance history) are left out.
  const current = complete ? undefined : g.contributions?.find((c) => c.isCurrent);
  const recent = g.contributions?.filter((c) => !c.isCurrent && c.actualCents !== null) ?? [];
  const loss = change && change.changeCents < 0 && change.summary;
  return (
    <article className={`gl-card${highlighted ? " is-highlighted" : ""}`} id={`goal-item-${g.goalId}`} style={{ ["--_goal" as string]: color }} aria-labelledby={`goal-name-${g.goalId}`}>
      <div className="gl-card__visual">
        <GoalPicture goalId={g.goalId} name={g.name} color={color} />
        <ProgressRing savedCents={g.savedCents} targetCents={g.targetCents} color={color} />
      </div>
      <div className="gl-card__body">
        <header className="gl-card__head">
          <span className="gl-swatch" aria-hidden="true" />
          <h3 id={`goal-name-${g.goalId}`} className="gl-card__name">
            {g.name}
          </h3>
          <span className="gl-muted">
            #{g.priority} in {g.accountName}
          </span>
        </header>
        <p className="gl-card__amount">
          <strong>{usd(g.savedCents)}</strong> <span className="gl-muted">of {usd(g.targetCents)}</span>
        </p>
        <ul className="gl-status">
          {complete && (
            <li>
              <StatusLabel status="on-track">Fully funded</StatusLabel>
            </li>
          )}
          {g.deadline && !complete && (
            <li>
              <StatusLabel status={g.deadline.aheadCents >= 0 ? "on-track" : g.deadline.overdue ? "over" : "warning"}>{g.deadline.aheadCents >= 0 ? "Ahead" : "Behind"}</StatusLabel>{" "}
              {g.deadline.label}
            </li>
          )}
          {current && (
            <li>
              {current.actualCents === null ? (
                <span className="gl-muted">Expecting {usd(current.expectedCents)} per period · not enough balance history yet to compare</span>
              ) : (
                <>
                  <StatusLabel status={current.met ? "on-track" : "warning"}>{current.met ? "Met" : "So far"}</StatusLabel> {current.label}
                </>
              )}
              {recent.length > 0 && (
                <span className="gl-recent" aria-label="Recent periods">
                  {recent.map((c) => (
                    <span key={c.start} className={`gl-recent__chip${c.met ? " is-met" : ""}`} title={c.label}>
                      {c.met === null ? "?" : c.met ? "✓" : "✗"} {c.actualCents === null ? "?" : usd(c.actualCents)}
                    </span>
                  ))}
                </span>
              )}
            </li>
          )}
          {!complete && (
            <li className="gl-projection">
              <Icon name="trajectory" size={14} /> {g.projection.label}
              {g.recentMonthlyRateCents !== null && <span className="gl-muted"> · recent rate {usd(g.recentMonthlyRateCents)}/month</span>}
            </li>
          )}
          {loss && (
            <li className="gl-loss">
              <Icon name="arrowDown" size={14} />{" "}
              {explainParams ? (
                <button
                  type="button"
                  className="bg-link-number gl-loss__link"
                  onClick={() => openDrillDown({ query: "goals.explainChanges", params: explainParams, figureId: "withdrawals", label: `Money out of ${g.accountName} since ${explainParams.since}` })}
                >
                  {change.summary}
                </button>
              ) : (
                change.summary
              )}
            </li>
          )}
          {g.accountWarning && (
            <li className="gl-warning">
              <Icon name="warning" size={14} /> {g.accountWarning}
            </li>
          )}
        </ul>
        <div className="gl-card__actions">
          <Button size="sm" onClick={onEdit} aria-label={`Edit ${g.name}`}>
            Edit
          </Button>
          {(complete || g.completedAt) && (
            <Button size="sm" variant="primary" icon="check" onClick={onArchive}>
              Archive as achievement
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
