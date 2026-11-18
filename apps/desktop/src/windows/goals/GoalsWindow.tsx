/**
 * Goals window (§11): "How funded is each goal, and when will it be reached?"
 *
 * Primary element: the goal cards. Secondary (tabs): planning (reorder,
 * what-if, account bar) and achievements (archived goals with their
 * purchase). Celebrations play on open.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, type Goals } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { OPEN_ITEM_EVENT, openDrillDown, type OpenItemRequest } from "../../data/drilldown.ts";
import { Button, EmptyState, Tabs } from "../../ui/components.tsx";
import { ActionConfirm, type ActionStep } from "../../ui/ActionConfirm.tsx";
import { longDate, todayIso, usd } from "../budgets/format.ts";
import { GoalCard } from "./GoalCard.tsx";
import { GoalCelebrations } from "./GoalCelebrations.tsx";
import { GoalEditor, LinkPurchase } from "./GoalEditor.tsx";
import { GoalPicture } from "./GoalPicture.tsx";
import { PlanView } from "./PlanView.tsx";
import { goalColor } from "./goalColors.ts";
import type { Achievement, ExplainValue, GoalCardValue, GoalsListValue } from "./types.ts";
import "../budgets/budgets.css";
import "./goals.css";
import { ExplainButton } from "../shared/ExplainButton.tsx";

type Tab = "goals" | "plan" | "achievements";

/** How far back "why did this goal lose money?" looks. */
// TODO(revisit): two weeks is a default; design.md §5 doesn't fix the window.
export const LOSS_LOOKBACK_DAYS = 14;

type Overlay =
  | { kind: "edit"; goal?: GoalCardValue }
  | { kind: "confirm"; title: string; steps: ActionStep[] }
  | { kind: "link"; achievement: Achievement };

export function GoalsWindow() {
  const list = useQuery<GoalsListValue>("goals.list", {});
  const [tab, setTab] = useState<Tab>("goals");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const goals = useMemo(() => list.data?.value.goals ?? [], [list.data]);
  const achievements = list.data?.value.achievements ?? [];

  const focusGoal = useCallback(
    (goalId: string | undefined) => {
      if (!goalId) return;
      setTab(achievements.some((a) => a.goalId === goalId) ? "achievements" : "goals");
      setHighlight(goalId);
      requestAnimationFrame(() => document.getElementById(`goal-item-${goalId}`)?.scrollIntoView?.({ block: "nearest" }));
      window.setTimeout(() => setHighlight((h) => (h === goalId ? null : h)), 2400);
    },
    [achievements],
  );
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<OpenItemRequest>).detail;
      if (d?.area === "goals") focusGoal(d.itemId);
    };
    window.addEventListener(OPEN_ITEM_EVENT, on);
    return () => window.removeEventListener(OPEN_ITEM_EVENT, on);
  }, [focusGoal]);

  const close = () => setOverlay(null);
  const overlayEl =
    overlay?.kind === "edit" ? (
      <GoalEditor goal={overlay.goal} siblings={goals} onClose={close} />
    ) : overlay?.kind === "confirm" ? (
      <ActionConfirm title={overlay.title} steps={overlay.steps} onCancel={close} onDone={close} />
    ) : overlay?.kind === "link" ? (
      <LinkPurchase goalId={overlay.achievement.goalId} name={overlay.achievement.name} targetCents={overlay.achievement.targetCents} onClose={close} />
    ) : null;

  let body;
  if (list.error && !list.data) {
    body = <EmptyState icon="warning" title="Couldn't load goals" description={list.error.message} action={{ label: "Try again", onClick: list.refetch }} />;
  } else if (!list.data) {
    body = <p className="gl-muted">Loading goals…</p>;
  } else if (goals.length === 0 && achievements.length === 0) {
    body = (
      <EmptyState
        icon="goals"
        title="No goals yet"
        description="Save toward something specific, like a bike or a trip. Money in the account fills goals in priority order."
        action={{ label: "Add a goal", icon: "plus", onClick: () => setOverlay({ kind: "edit" }) }}
      />
    );
  } else {
    body = (
      <>
        <Tabs
          label="Goal views"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "goals", label: "Goals" },
            { value: "plan", label: "Plan" },
            { value: "achievements", label: `Achievements${achievements.length ? ` (${achievements.length})` : ""}` },
          ]}
        />
        <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="gl-panel">
          {tab === "goals" && (
            <CardsView
              goals={goals}
              highlight={highlight}
              onEdit={(g) => setOverlay({ kind: "edit", goal: g })}
              onArchive={(g) => setOverlay({ kind: "confirm", title: `Archive "${g.name}" as an achievement`, steps: [{ name: "goals.archive", input: { goalId: g.goalId, archived: true } }] })}
              onAdd={() => setOverlay({ kind: "edit" })}
            />
          )}
          {tab === "plan" && (goals.length > 0 ? <PlanView goals={goals} /> : <p className="gl-muted">No active goals to plan.</p>)}
          {tab === "achievements" && (
            <AchievementsView
              achievements={achievements}
              highlight={highlight}
              onLink={(a) => setOverlay({ kind: "link", achievement: a })}
              onRestore={(a) => setOverlay({ kind: "confirm", title: `Bring back "${a.name}"`, steps: [{ name: "goals.archive", input: { goalId: a.goalId, archived: false } }] })}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="bg-window gl-window">
      <header className="bg-header">
        <div>
          <p className="bg-eyebrow">Savings goals</p>
          <h2 className="bg-title">{goals.length === 0 ? "Goals" : `${usd(goals.reduce((s, g) => s + g.savedCents, 0))} saved of ${usd(goals.reduce((s, g) => s + g.targetCents, 0))}`}</h2>
        </div>
        {(goals.length > 0 || achievements.length > 0) && (
          <div className="bg-header__controls">
            {goals.length > 0 && <ExplainButton figure={{ query: "goals.list", params: {}, label: "my savings goals" }} />}
            <Button size="sm" icon="plus" variant="primary" onClick={() => setOverlay({ kind: "edit" })}>
              Add goal
            </Button>
          </div>
        )}
      </header>
      {body}
      {overlayEl}
      <GoalCelebrations />
    </div>
  );
}

function CardsView({
  goals,
  highlight,
  onEdit,
  onArchive,
  onAdd,
}: {
  goals: GoalCardValue[];
  highlight: string | null;
  onEdit: (g: GoalCardValue) => void;
  onArchive: (g: GoalCardValue) => void;
  onAdd: () => void;
}) {
  const since = addDays(todayIso(), -LOSS_LOOKBACK_DAYS);
  const accountIds = [...new Set(goals.map((g) => g.accountId))];
  if (goals.length === 0) return <EmptyState icon="goals" title="No active goals" description="Your finished goals are under Achievements." action={{ label: "Add a goal", icon: "plus", onClick: onAdd }} />;
  return (
    <div className="gl-cards">
      {accountIds.map((accountId) => (
        <AccountCards key={accountId} accountId={accountId} since={since} goals={goals.filter((g) => g.accountId === accountId).sort((a, b) => a.priority - b.priority)} highlight={highlight} onEdit={onEdit} onArchive={onArchive} />
      ))}
    </div>
  );
}

function AccountCards({
  accountId,
  since,
  goals,
  highlight,
  onEdit,
  onArchive,
}: {
  accountId: string;
  since: string;
  goals: GoalCardValue[];
  highlight: string | null;
  onEdit: (g: GoalCardValue) => void;
  onArchive: (g: GoalCardValue) => void;
}) {
  const params = { accountId, since };
  const explain = useQuery<ExplainValue>("goals.explainChanges", params);
  const changes = new Map<string, Goals.GoalChange>((explain.data?.value.changes ?? []).map((c) => [c.goalId, c]));
  return (
    <>
      {goals.map((g) => (
        <GoalCard key={g.goalId} goal={g} change={changes.get(g.goalId)} explainParams={params} highlighted={highlight === g.goalId} onEdit={() => onEdit(g)} onArchive={() => onArchive(g)} />
      ))}
    </>
  );
}

function AchievementsView({
  achievements,
  highlight,
  onLink,
  onRestore,
}: {
  achievements: Achievement[];
  highlight: string | null;
  onLink: (a: Achievement) => void;
  onRestore: (a: Achievement) => void;
}) {
  if (achievements.length === 0) {
    return <EmptyState icon="check" title="No achievements yet" description="When a goal is fully funded, archive it here and link the purchase." />;
  }
  return (
    <ul className="gl-achievements">
      {achievements.map((a) => (
        <li key={a.goalId} id={`goal-item-${a.goalId}`} className={`gl-achievement${highlight === a.goalId ? " is-highlighted" : ""}`} style={{ ["--_goal" as string]: goalColor(a.colorSlot) }}>
          <GoalPicture goalId={a.goalId} name={a.name} color={goalColor(a.colorSlot)} size={72} />
          <div className="gl-achievement__body">
            <h3 className="gl-card__name">{a.name}</h3>
            <p className="gl-muted">
              {usd(a.targetCents)} goal{a.completedAt ? ` · reached ${longDate(a.completedAt.slice(0, 10))}` : ""}
            </p>
            {a.purchase ? (
              <p>
                Bought:{" "}
                <button
                  type="button"
                  className="bg-link-number"
                  onClick={() => openDrillDown({ query: "goals.list", params: {}, figureId: `purchase.${a.goalId}`, label: `${a.name} purchase` })}
                >
                  {a.purchase.name} · {longDate(a.purchase.date)} · {usd(-a.purchase.amountCents)}
                </button>
              </p>
            ) : (
              <p className="gl-muted">No purchase linked.</p>
            )}
          </div>
          <div className="gl-card__actions">
            <Button size="sm" onClick={() => onLink(a)}>
              {a.purchase ? "Change purchase" : "Link purchase"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onRestore(a)}>
              Restore
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
