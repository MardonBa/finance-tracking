/**
 * Overview (§13): "Where do I stand today?" at a glance, no clicks needed.
 * Every card loads its own registry query in parallel and renders as soon as
 * its data arrives (progressive), and every element clicks through to the
 * window (or transactions) behind it. The alerts strip shows only when
 * something needs dealing with.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Money, addDays, addMonths, monthOf, monthStart } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { openDrillDown, openItem } from "../../data/drilldown.ts";
import { useWindow } from "../../shell/context.ts";
import { Icon } from "../../ui/Icon.tsx";
import { StatusLabel, type Status } from "../../ui/components.tsx";
import { foldOther, OTHER_KEY } from "../../ui/colorMap.ts";
import { AddAccountMenu } from "../../accounts/AddAccountMenu.tsx";
import { openAccountSheet } from "../../accounts/AccountSheets.tsx";
import { RefreshButton } from "../../connections/RefreshButton.tsx";
import { requestReconnect } from "../../connections/events.ts";
import { isOutOfDate, relativeTime, useConnections } from "../../connections/useConnections.ts";
import type { ConnectionHealth } from "../../connections/api.ts";
import { todayIso } from "../../accounts/manual.tsx";
import { computeAlerts, type BelowZeroWarning, type OverviewAlert } from "./alerts.ts";
import { overviewCategoryColors } from "./adapters.tsx";
import { GoalCelebrations } from "../goals/GoalCelebrations.tsx";
import { GoalPicture } from "../goals/GoalPicture.tsx";
import { goalColor } from "../goals/goalColors.ts";
import "../../dialogs/dialogs.css";
import "./overview.css";

// ------------------------------------------------------------------ query shapes (what the cards read)

interface MonthlySummary {
  month: string;
  spendingCents: number;
  usual: { basis: { label: string }; spendingCents: number } | null;
}
interface ByCategory {
  totalCents: number;
  categories: Array<{ category: string; label: string; cents: number; count: number }>;
}
interface TxRow {
  transactionId: string;
  date: string;
  merchantName: string | null;
  rawDescription: string;
  categoryLabel: string | null;
  amountCents: number;
  markers: { pending: boolean };
}
interface Bar {
  id: string;
  name: string;
  plannedCents: number | null;
  spentCents: number;
  paceCents: number | null;
  projectedCents: number | null;
  status: "on_pace" | "ahead_of_pace" | "over" | "under" | "no_plan";
}
interface BudgetView {
  budgetId: string;
  name: string;
  period: { start: string; end: string };
  overall: Bar;
  parts: Bar[];
  everythingElse: Bar | null;
}
interface GoalCard {
  goalId: string;
  name: string;
  colorSlot: number;
  savedCents: number;
  targetCents: number;
  percent: number;
  deadline: { aheadCents: number; overdue: boolean; label: string } | null;
  contributions: Array<{ isCurrent: boolean; met: boolean | null; label: string }>;
  projection: { label: string } | null;
}
interface AccountRow {
  id: string;
  itemId: string | null;
  name: string;
  kind: string;
  isDebt: boolean;
  isManual: boolean;
  balanceCents: number | null;
  balanceUpdatedAt: string | null;
}
interface ChartPoint {
  date: string;
  totalCents: number;
  breakdown: Array<{ cents: number | null }>;
}

// ------------------------------------------------------------------ helpers

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const money = (c: number) => Money.format(c, { noCents: Math.abs(c) >= 100_000 });

function Section({
  title,
  className,
  onOpen,
  openLabel,
  children,
  loading,
}: {
  title: string;
  className: string;
  onOpen?: () => void;
  openLabel?: string;
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <section className={`ov-card ${className}`} aria-busy={loading || undefined}>
      <header className="ov-card__header">
        <h3 className="ov-card__title">{title}</h3>
        {onOpen && (
          <button type="button" className="ov-card__open" onClick={onOpen} aria-label={openLabel ?? `Open ${title}`}>
            <Icon name="chevronRight" size={14} />
          </button>
        )}
      </header>
      <div className="ov-card__body">{loading ? <div className="ov-skeleton" aria-label="Loading" /> : children}</div>
    </section>
  );
}

/** Accounts whose bank is out of date (§4): dismissing the reconnect prompt keeps them marked. */
function staleAccounts(accounts: readonly AccountRow[] | undefined, connections: readonly ConnectionHealth[] | undefined): Map<string, ConnectionHealth> {
  const out = new Map<string, ConnectionHealth>();
  if (!accounts || !connections) return out;
  for (const a of accounts) {
    const c = a.itemId ? connections.find((x) => x.itemId === a.itemId) : undefined;
    if (c && isOutOfDate(c)) out.set(a.id, c);
  }
  return out;
}

// ------------------------------------------------------------------ the window

export function OverviewWindow() {
  const w = useWindow();
  const today = useMemo(() => todayIso(), []);
  const month = monthOf(today);
  const lastMonthDay = addMonths(today, -1);

  // All in parallel; each card renders when its own data lands.
  const summary = useQuery<MonthlySummary>("spending.monthlySummary", { month, usualMonths: 3 });
  const byCat = useQuery<ByCategory>("spending.byCategory", { from: monthStart(month), to: today, level: "primary" });
  const recent = useQuery<{ rows: TxRow[] }>("transactions.list", { measure: "amount", buckets: ["spending"], includePending: true, to: today, limit: 10 });
  const budgets = useQuery<BudgetView[]>("budgets.overview", {});
  const goals = useQuery<{ goals: GoalCard[] }>("goals.list", {});
  const netWorth = useQuery<{ totalCents: number; date: string }>("balances.netWorth", {});
  const chart = useQuery<{ points: ChartPoint[] }>("balances.netWorthChart", { from: addDays(lastMonthDay, -1), to: today, grouping: "type", fill: "carry" });
  const accounts = useQuery<{ accounts: AccountRow[] }>("accounts.list", { includeHidden: false });
  const upcoming = useQuery<{ warnings: BelowZeroWarning[] }>("recurring.upcoming", {});
  const needsALook = useQuery<{ count: number }>("flows.needsALook", {});
  const recon = useQuery<{ unexplainedCount: number }>("flows.reconciliation", { from: monthStart(month), to: today });
  const connections = useConnections(w.token, { pollWhileImporting: true });

  // Time to data after unlock (§13 "within about a second"): logged once, and exposed for the dev check.
  const mounted = useRef(performance.now());
  const core = [summary, byCat, recent, budgets, goals, netWorth, accounts];
  const ready = core.every((q) => q.data || q.error) && (connections.items || connections.error);
  useEffect(() => {
    if (!ready) return;
    const ms = Math.round(performance.now() - mounted.current);
    (window as unknown as { __ftOverviewReadyMs?: number }).__ftOverviewReadyMs ??= ms;
    console.info(`[overview] data ready in ${ms} ms`);
  }, [ready]);

  const stale = staleAccounts(accounts.data?.value.accounts, connections.items);
  const alerts = computeAlerts({
    lowBalance: upcoming.data?.value.warnings,
    connections: connections.items,
    unexplainedCount: recon.data?.value.unexplainedCount,
    needsALookCount: needsALook.data?.value.count,
  });

  const runAlert = (a: OverviewAlert) => {
    if (a.kind === "reconnect" && a.itemId) requestReconnect(a.itemId);
    else if (a.kind === "low-balance") openItem({ area: "recurring" });
    // TODO(revisit): wire after merge — the Transactions window's item ids for its review lists are assumed.
    else if (a.kind === "needs-a-look") openItem({ area: "transactions", itemId: "needs-a-look" });
    else openItem({ area: "transactions", itemId: "reconciliation" });
  };

  const noAccounts = accounts.data && accounts.data.value.accounts.length === 0 && connections.items?.length === 0;

  return (
    <div className="ov" data-ready={ready ? "true" : undefined}>
      <header className="ov-header">
        <div>
          <h2 className="ov-header__title">Today</h2>
          <p className="ov-header__date">{new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="ft-row">
          <RefreshButton token={w.token} connections={connections.items} />
          <AddAccountMenu onAddBank={w.addBanks} />
        </div>
      </header>

      {alerts.length > 0 && (
        <ul className="ov-alerts" aria-label="Needs attention">
          {alerts.map((a) => (
            <li key={a.id} className={`ov-alert ov-alert--${a.kind}`}>
              <Icon name="warning" size={14} />
              <span className="ov-alert__text">{a.text}</span>
              <button type="button" className="ft-link" onClick={() => runAlert(a)}>
                {a.action}
              </button>
            </li>
          ))}
        </ul>
      )}

      {noAccounts ? (
        <div className="ov-empty">
          <Icon name="bank" size={28} />
          <p className="ov-empty__title">No accounts yet</p>
          <p className="ft-muted">Your spending, budgets, goals and net worth show up here once a bank or a manual account is added.</p>
          <AddAccountMenu onAddBank={w.addBanks} size="md" />
        </div>
      ) : (
        <div className="ov-grid">
          <NetWorthCard netWorth={netWorth} chart={chart} lastMonthDay={lastMonthDay} staleCount={stale.size} onOpen={() => openItem({ area: "trajectory" })} />
          <SpendingCard summary={summary} byCat={byCat} month={month} today={today} staleCount={stale.size} />
          <BudgetsCard budgets={budgets} />
          <AccountsCard accounts={accounts} stale={stale} connections={connections.items} />
          <RecentCard recent={recent} />
          <GoalsCard goals={goals} />
        </div>
      )}
      <GoalCelebrations />
    </div>
  );
}

// ------------------------------------------------------------------ cards

type Q<V> = ReturnType<typeof useQuery<V>>;

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="ov-spark ov-spark--empty">History builds up day by day</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`).join(" ");
  return (
    <svg className="ov-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function NetWorthCard({
  netWorth,
  chart,
  lastMonthDay,
  staleCount,
  onOpen,
}: {
  netWorth: Q<{ totalCents: number }>;
  chart: Q<{ points: ChartPoint[] }>;
  lastMonthDay: string;
  staleCount: number;
  onOpen: () => void;
}) {
  const total = netWorth.data?.value.totalCents;
  const known = (chart.data?.value.points ?? []).filter((p) => p.breakdown.some((b) => b.cents !== null));
  const then = known.find((p) => p.date >= lastMonthDay && p.date <= addDays(lastMonthDay, 1));
  const change = total !== undefined && then ? total - then.totalCents : null;
  return (
    <Section title="Net worth" className="ov-networth" onOpen={onOpen} openLabel="Open Trajectory" loading={!netWorth.data && !netWorth.error}>
      <button type="button" className="ov-big ov-click" onClick={onOpen} aria-label={`Net worth ${total !== undefined ? Money.format(total) : ""}. Open Trajectory`}>
        <span className="ft-num">{total !== undefined ? money(total) : "—"}</span>
      </button>
      <p className="ov-sub">
        {change === null ? (
          <span className="ft-muted">No balance from a month ago yet</span>
        ) : (
          <>
            <Icon name={change >= 0 ? "arrowUp" : "arrowDown"} size={12} /> {Money.format(change, { showPlus: true, noCents: true })} since {shortDate(lastMonthDay)}
          </>
        )}
      </p>
      <Sparkline points={known.map((p) => p.totalCents)} />
      {staleCount > 0 && <p className="ov-stale-note">Includes {staleCount} out-of-date account{staleCount === 1 ? "" : "s"}</p>}
    </Section>
  );
}

function SpendingCard({ summary, byCat, month, today, staleCount }: { summary: Q<MonthlySummary>; byCat: Q<ByCategory>; month: string; today: string; staleCount: number }) {
  const s = summary.data?.value;
  const cats = byCat.data?.value.categories ?? [];
  const total = byCat.data?.value.totalCents ?? 0;
  const items = cats.map((c) => ({ key: c.category, label: c.label, value: c.cents }));
  const colored = foldOther(items, overviewCategoryColors(items)).slice(0, 6);
  const diff = s?.usual ? s.spendingCents - s.usual.spendingCents : null;
  const params = { from: monthStart(month), to: today, level: "primary" };
  const openSpending = () => openItem({ area: "spending" });
  return (
    <Section title="Spending this month" className="ov-spending" onOpen={openSpending} openLabel="Open Spending" loading={!s && !summary.error}>
      <button
        type="button"
        className="ov-big ov-click"
        onClick={() => openDrillDown({ query: "spending.monthlySummary", params: { month, usualMonths: 3 }, figureId: "spending", label: `Spending · ${month}` })}
        aria-label={`Spent ${s ? Money.format(s.spendingCents) : ""} this month. Show transactions`}
      >
        <span className="ft-num">{s ? money(s.spendingCents) : "—"}</span>
      </button>
      <p className="ov-sub">
        {diff === null ? (
          <span className="ft-muted">No usual to compare with yet</span>
        ) : (
          <StatusLabel status={(diff > 0 ? "over" : "under") as Status}>
            {Money.format(Math.abs(diff), { noCents: true })} {diff > 0 ? "more" : "less"} than usual
          </StatusLabel>
        )}
      </p>
      {total > 0 && (
        <>
          <div className="ov-stack" role="list" aria-label="Spending by category">
            {colored.map((c) => (
              <button
                key={c.key}
                type="button"
                role="listitem"
                className="ov-stack__seg"
                style={{ flexGrow: Math.max(c.value, 0), background: c.color }}
                title={`${c.label}: ${Money.format(c.value)}`}
                aria-label={`${c.label}: ${Money.format(c.value)}. Show transactions`}
                onClick={() =>
                  c.key === OTHER_KEY
                    ? openSpending()
                    : openDrillDown({ query: "spending.byCategory", params, figureId: `category.${c.key}`, label: `${c.label} · this month` })
                }
              />
            ))}
          </div>
          <ul className="ov-legend">
            {colored.slice(0, 4).map((c) => (
              <li key={c.key}>
                <span className="ov-legend__dot" style={{ background: c.color }} />
                <span className="ov-legend__label">{c.label}</span>
                <span className="ft-num">{Money.format(c.value, { noCents: true })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {total === 0 && s && <p className="ft-muted ft-small">Nothing spent yet this month.</p>}
      {staleCount > 0 && <p className="ov-stale-note">Some accounts are out of date</p>}
    </Section>
  );
}

function barStatus(b: Bar): { status: Status; text: string } | null {
  if (b.status === "over") return { status: "over", text: "Over" };
  if (b.status === "ahead_of_pace") return { status: "warning", text: "Running hot" };
  if (b.status === "on_pace" || b.status === "under") return { status: "on-track", text: "On pace" };
  return null;
}

function BudgetBar({ bar }: { bar: Bar }) {
  const planned = bar.plannedCents ?? 0;
  const pct = planned > 0 ? Math.min(100, (bar.spentCents / planned) * 100) : 0;
  const pace = planned > 0 && bar.paceCents !== null ? Math.min(100, (bar.paceCents / planned) * 100) : null;
  return (
    <div className={`ov-bar ov-bar--${bar.status}`}>
      <div className="ov-bar__fill" style={{ width: `${pct}%` }} />
      {pace !== null && <div className="ov-bar__pace" style={{ left: `${pace}%` }} title="Where spending should be by today" />}
    </div>
  );
}

function BudgetsCard({ budgets }: { budgets: Q<BudgetView[]> }) {
  const list = budgets.data?.value ?? [];
  const b = list[0];
  const open = (itemId?: string) => openItem({ area: "budgets", itemId });
  if (budgets.data && !b) {
    return (
      <Section title="Budget" className="ov-budgets" onOpen={() => open()}>
        <p className="ft-muted ft-small">No budget yet · </p>
        <button type="button" className="ft-link" onClick={() => open()}>
          Set a monthly budget
        </button>
      </Section>
    );
  }
  const hot = b ? [...b.parts, ...(b.everythingElse ? [b.everythingElse] : [])].filter((p) => p.status === "over" || p.status === "ahead_of_pace").slice(0, 3) : [];
  const st = b ? barStatus(b.overall) : null;
  return (
    <Section title={b?.name ?? "Budget"} className="ov-budgets" onOpen={() => open(b?.budgetId)} openLabel="Open Budgets" loading={!budgets.data && !budgets.error}>
      {b && (
        <button type="button" className="ov-click ov-budget" onClick={() => open(b.budgetId)} aria-label={`${b.name}: ${Money.format(b.overall.spentCents)} of ${Money.format(b.overall.plannedCents ?? 0)}. Open Budgets`}>
          <span className="ov-budget__nums">
            <strong className="ft-num">{money(b.overall.spentCents)}</strong>
            <span className="ft-muted ft-small"> of {money(b.overall.plannedCents ?? 0)}</span>
            {st && <StatusLabel status={st.status}>{st.text}</StatusLabel>}
          </span>
          <BudgetBar bar={b.overall} />
        </button>
      )}
      {hot.length > 0 ? (
        <ul className="ov-hot">
          {hot.map((p) => {
            const s = barStatus(p)!;
            return (
              <li key={p.id}>
                <button type="button" className="ov-click ov-hot__row" onClick={() => open(b!.budgetId)} aria-label={`${p.name}: ${s.text}. Open Budgets`}>
                  <span className="ov-hot__name">{p.name}</span>
                  <span className="ft-num ft-small">
                    {money(p.spentCents)} / {money(p.plannedCents ?? 0)}
                  </span>
                  <StatusLabel status={s.status}>{s.text}</StatusLabel>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        b && <p className="ft-muted ft-small">Every part is on pace.</p>
      )}
    </Section>
  );
}

function AccountsCard({
  accounts,
  stale,
  connections,
}: {
  accounts: Q<{ accounts: AccountRow[] }>;
  stale: Map<string, ConnectionHealth>;
  connections: ConnectionHealth[] | undefined;
}) {
  const rows = accounts.data?.value.accounts ?? [];
  return (
    <Section title="Accounts" className="ov-accounts" loading={!accounts.data && !accounts.error}>
      <ul className="ov-accounts__list">
        {rows.map((a) => {
          const conn = a.itemId ? connections?.find((c) => c.itemId === a.itemId) : undefined;
          const bad = stale.get(a.id);
          const importing = conn?.importStatus === "importing" && !bad;
          const updated = a.isManual ? null : (conn?.lastUpdatedAt ?? a.balanceUpdatedAt);
          return (
            <li key={a.id}>
              <button type="button" className="ov-click ov-account" onClick={() => openAccountSheet(a.id)} aria-label={`${a.name}${bad ? ", out of date" : ""}. Account details`}>
                <span className="ov-account__name">
                  {a.name}
                  {a.isManual && <span className="ft-badge">Manual</span>}
                </span>
                <span className={`ov-account__bal ft-num${a.isDebt ? " is-debt" : ""}`}>{a.balanceCents === null ? "—" : money(a.balanceCents)}</span>
                <span className={`ov-account__meta${bad ? " is-stale" : ""}`}>
                  {bad ? (
                    <>
                      <Icon name="warning" size={11} /> Out of date · {relativeTime(updated)}
                    </>
                  ) : importing ? (
                    "Importing transactions…"
                  ) : a.isManual ? (
                    "Entered by hand"
                  ) : (
                    `Updated ${relativeTime(updated)}`
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** How many fixed-height rows fit in the element (the Overview never scrolls, §13). */
function useFitCount(ref: RefObject<HTMLElement | null>, rowPx: number, min: number): number {
  const [n, setN] = useState(min);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setN(Math.max(min, Math.floor(el.clientHeight / rowPx)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rowPx, min]);
  return n;
}

export const RECENT_ROW_PX = 35;

function RecentCard({ recent }: { recent: Q<{ rows: TxRow[] }> }) {
  const listRef = useRef<HTMLDivElement>(null);
  // At least 7 at the default size; more when the window is taller.
  const fit = useFitCount(listRef, RECENT_ROW_PX, 7);
  const rows = (recent.data?.value.rows ?? []).slice(0, fit);
  return (
    <Section title="Recent spending" className="ov-recent" onOpen={() => openItem({ area: "transactions" })} openLabel="Open Transactions" loading={!recent.data && !recent.error}>
      <div ref={listRef} className="ov-recent__fit">
      {rows.length === 0 ? (
        <p className="ft-muted ft-small">No spending yet.</p>
      ) : (
        <ul className="ov-recent__list">
          {rows.map((t) => (
            <li key={t.transactionId}>
              <button
                type="button"
                className="ov-click ov-tx"
                onClick={() => openItem({ area: "transactions", itemId: t.transactionId })}
                aria-label={`${t.merchantName ?? t.rawDescription}, ${Money.format(t.amountCents)}, ${shortDate(t.date)}. Transaction details`}
              >
                <span className="ov-tx__merchant">{t.merchantName ?? t.rawDescription}</span>
                <span className="ov-tx__amount ft-num">{Money.format(t.amountCents)}</span>
                <span className="ov-tx__meta">
                  {t.categoryLabel ?? "Uncategorised"} · {shortDate(t.date)}
                  {t.markers.pending ? " · pending" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </Section>
  );
}

function goalStatus(g: GoalCard): { status: Status; text: string } {
  if (g.percent >= 100) return { status: "on-track", text: "Reached" };
  if (g.deadline) {
    if (g.deadline.overdue) return { status: "over", text: "Past deadline" };
    return g.deadline.aheadCents >= 0 ? { status: "on-track", text: "On track" } : { status: "warning", text: "Behind" };
  }
  const current = g.contributions.find((c) => c.isCurrent);
  if (current && current.met === false) return { status: "warning", text: "Behind" };
  if (current && current.met === true) return { status: "on-track", text: "On track" };
  return { status: "on-track", text: g.projection?.label ?? "Saving" };
}

function GoalsCard({ goals }: { goals: Q<{ goals: GoalCard[] }> }) {
  const list = goals.data?.value.goals ?? [];
  const shown = list.slice(0, 4);
  const open = (itemId?: string) => openItem({ area: "goals", itemId });
  return (
    <Section title="Goals" className="ov-goals" onOpen={() => open()} openLabel="Open Goals" loading={!goals.data && !goals.error}>
      {goals.data && list.length === 0 ? (
        <p className="ft-muted ft-small">
          No goals yet ·{" "}
          <button type="button" className="ft-link" onClick={() => open()}>
            Add a goal
          </button>
        </p>
      ) : (
        <ul className="ov-goals__list">
          {shown.map((g) => {
            const s = goalStatus(g);
            const color = goalColor(g.colorSlot);
            return (
              <li key={g.goalId}>
                <button type="button" className="ov-click ov-goal" onClick={() => open(g.goalId)} aria-label={`${g.name}: ${Math.round(g.percent)}% saved, ${s.text}. Open Goals`}>
                  <span className="ov-goal__pic">
                    <GoalPicture goalId={g.goalId} name={g.name} color={color} size={32} editable={false} />
                  </span>
                  <span className="ov-goal__main">
                    <span className="ov-goal__name">{g.name}</span>
                    <span className="ov-goal__track">
                      <span className="ov-goal__fill" style={{ width: `${Math.min(100, g.percent)}%`, background: color }} />
                    </span>
                    <span className="ov-goal__meta">
                      <span className="ft-num">
                        {money(g.savedCents)} / {money(g.targetCents)}
                      </span>
                      <StatusLabel status={s.status}>{s.text}</StatusLabel>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {list.length > shown.length && (
            <li className="ft-small ft-muted">
              <button type="button" className="ft-link" onClick={() => open()}>
                +{list.length - shown.length} more
              </button>
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

export const __test = { staleAccounts, goalStatus, barStatus };
export type { AccountRow as OverviewAccountRow };
