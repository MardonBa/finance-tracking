/**
 * Goal celebrations (§11). Reads `goals.celebrations`, plays a small
 * animation per goal that crossed a milestone and a bigger one featuring the
 * goal's picture when a goal is completed, then records them with
 * `goals.markMilestonesSeen` so each plays only once (even if the balance
 * dips and comes back). Under "Reduce motion" it's a gentle fade.
 *
 * Mounted by the Goals window, and by the Overview window:
 *
 *   import { GoalCelebrations } from "../goals/GoalCelebrations.tsx";
 *   ...
 *   <GoalCelebrations />   // anywhere inside the window; renders into document.body
 *
 * Both can be mounted at once: a milestone claimed by one overlay is never
 * played by the other in the same session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActions, useQuery } from "../../data/hooks.ts";
import { Button } from "../../ui/components.tsx";
import { usd } from "../budgets/format.ts";
import { GoalPicture } from "./GoalPicture.tsx";
import { goalColor } from "./goalColors.ts";
import type { CelebrationItem, CelebrationsValue, GoalsListValue } from "./types.ts";
import "./celebrations.css";

/** Milestones already taken by an overlay this session ("goalId:cents"). */
const claimed = new Set<string>();

/** Tests only. */
export function resetCelebrationClaims(): void {
  claimed.clear();
}

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export interface Celebration {
  goalId: string;
  name: string;
  kind: "progress" | "completion";
  /** The highest milestone crossed (shown), and every one being recorded. */
  top: CelebrationItem;
  milestonesCents: number[];
}

/** One celebration per goal: its completion if reached, else its highest new milestone. */
export function groupCelebrations(pending: readonly CelebrationItem[]): Celebration[] {
  const byGoal = new Map<string, CelebrationItem[]>();
  for (const p of pending) byGoal.set(p.goalId, [...(byGoal.get(p.goalId) ?? []), p]);
  return [...byGoal.values()].map((items) => {
    const top = items.reduce((a, b) => (b.cents > a.cents ? b : a));
    return {
      goalId: top.goalId,
      name: top.name,
      kind: items.some((i) => i.kind === "completion") ? "completion" : "progress",
      top,
      milestonesCents: items.map((i) => i.cents),
    };
  });
}

const SMALL_MS = 3200;
const BIG_MS = 6000;

export interface GoalCelebrationsProps {
  /** Override auto-advance timing (tests). */
  durations?: { small: number; big: number };
}

export function GoalCelebrations({ durations = { small: SMALL_MS, big: BIG_MS } }: GoalCelebrationsProps) {
  const q = useQuery<CelebrationsValue>("goals.celebrations", {});
  const list = useQuery<GoalsListValue>("goals.list", {});
  const actions = useActions();
  const reduced = usePrefersReducedMotion();
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [index, setIndex] = useState(0);
  const marked = useRef(new Set<string>());

  // Take new celebrations once the current queue has finished.
  const pending = q.data?.value.pending;
  useEffect(() => {
    if (!pending || index < queue.length) return;
    const fresh = pending.filter((p) => !claimed.has(`${p.goalId}:${p.cents}`));
    if (fresh.length === 0) return;
    fresh.forEach((p) => claimed.add(`${p.goalId}:${p.cents}`));
    setQueue(groupCelebrations(fresh));
    setIndex(0);
  }, [pending, index, queue.length]);

  const current = index < queue.length ? queue[index] : undefined;

  // Record as seen as soon as it plays, so closing the window can't replay it.
  useEffect(() => {
    if (!current) return;
    const key = `${current.goalId}:${current.milestonesCents.join(",")}`;
    if (marked.current.has(key)) return;
    marked.current.add(key);
    actions.run("goals.markMilestonesSeen", { goalId: current.goalId, milestonesCents: current.milestonesCents }).catch(() => {
      // Not fatal: it plays again next time.
      marked.current.delete(key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const next = useCallback(() => setIndex((i) => i + 1), []);

  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(next, current.kind === "completion" ? durations.big : durations.small);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && next();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [current, next, durations.big, durations.small]);

  const card = list.data?.value.goals.find((g) => g.goalId === current?.goalId);
  const color = goalColor(card?.colorSlot ?? 0);
  const confetti = useMemo(() => Array.from({ length: current?.kind === "completion" ? 28 : 12 }, (_, i) => i), [current?.kind]);
  if (!current || typeof document === "undefined") return null;

  const big = current.kind === "completion";
  const motion = reduced ? "reduced" : "full";
  return createPortal(
    <div
      className={`gc-overlay gc-overlay--${big ? "big" : "small"} gc-motion--${motion}`}
      data-motion={motion}
      data-testid="goal-celebration"
      role="status"
      aria-live="polite"
      style={{ ["--_goal" as string]: color }}
      onClick={big ? next : undefined}
    >
      {!reduced && (
        <div className="gc-confetti" aria-hidden="true" data-testid="confetti">
          {confetti.map((i) => (
            <span key={i} className={`gc-bit gc-bit--${i % 4}`} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 60}ms` }} />
          ))}
        </div>
      )}
      <div className="gc-card" onClick={(e) => e.stopPropagation()}>
        {big ? (
          <>
            <GoalPicture goalId={current.goalId} name={current.name} color={color} size={180} editable={false} />
            <p className="gc-eyebrow">Goal reached</p>
            <h2 className="gc-title">{current.name}</h2>
            <p className="gc-detail">{usd(current.top.cents)} saved. Well done!</p>
            <Button variant="primary" onClick={next}>
              Celebrate
            </Button>
          </>
        ) : (
          <>
            <span className="gc-badge" aria-hidden="true">
              {Math.round(current.top.percent)}%
            </span>
            <div>
              <p className="gc-title gc-title--small">
                {current.name} passed {usd(current.top.cents)}
              </p>
              <p className="gc-detail">
                {Math.round(current.top.percent)}% of the way there{current.milestonesCents.length > 1 ? ` · ${current.milestonesCents.length} milestones` : ""}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={next} aria-label="Dismiss celebration">
              Nice
            </Button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
