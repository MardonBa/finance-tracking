/**
 * Create/edit a goal (§11): name, target, account, priority, deadline and
 * expected contribution. Also links a completed goal to its purchase. All
 * through registry actions with the before → after preview.
 */
import { useState, type FormEvent } from "react";
import type { ContributionPeriod } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Button, Input, Select } from "../../ui/components.tsx";
import { ActionConfirm, type ActionStep } from "../../ui/ActionConfirm.tsx";
import { dollarsText, longDate, parseDollars, usd } from "../budgets/format.ts";
import type { GoalCardValue } from "./types.ts";

interface AccountRow {
  id: string;
  name: string;
  isDebt: boolean;
  hidden: boolean;
  balanceCents: number | null;
}

type Pending = { title: string; steps: ActionStep[]; destructive?: boolean };

export function GoalEditor({ goal, siblings, onClose }: { goal?: GoalCardValue; siblings: GoalCardValue[]; onClose: () => void }) {
  const accounts = useQuery<AccountRow[]>("accounts.list", { includeHidden: false });
  const usable = (accounts.data?.value ?? []).filter((a) => !a.isDebt);
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(dollarsText(goal?.targetCents));
  const [accountId, setAccountId] = useState(goal?.accountId ?? "");
  const [priority, setPriority] = useState("");
  const [deadline, setDeadline] = useState(goal?.plan.deadline ?? "");
  const [contribution, setContribution] = useState(dollarsText(goal?.plan.expectedContributionCents));
  const [period, setPeriod] = useState<ContributionPeriod>(goal?.plan.contributionPeriod ?? "monthly");

  const account = accountId || usable[0]?.id || "";
  const targetCents = parseDollars(target);
  const contribCents = contribution.trim() ? parseDollars(contribution) : null;
  const contribBad = contribution.trim() !== "" && (contribCents === null || contribCents === 0);
  const onAccount = siblings.filter((s) => s.accountId === account && s.goalId !== goal?.goalId).sort((a, b) => a.priority - b.priority);
  const valid = name.trim() && targetCents !== null && targetCents > 0 && account && !contribBad;

  if (pending) {
    return <ActionConfirm title={pending.title} steps={pending.steps} destructive={pending.destructive} confirmLabel={pending.destructive ? "Delete" : "Save"} onCancel={() => setPending(null)} onDone={onClose} />;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || targetCents === null) return;
    if (!goal) {
      setPending({
        title: `Create "${name.trim()}"`,
        steps: [
          {
            name: "goals.create",
            input: {
              name: name.trim(),
              accountId: account,
              targetCents,
              deadline: deadline || null,
              expectedContributionCents: contribCents,
              contributionPeriod: contribCents === null ? null : period,
              ...(priority ? { priority: Number(priority) } : {}),
            },
          },
        ],
      });
      return;
    }
    const steps: ActionStep[] = [];
    const edit: Record<string, unknown> = { goalId: goal.goalId };
    if (name.trim() !== goal.name) edit.name = name.trim();
    if (targetCents !== goal.targetCents) edit.targetCents = targetCents;
    if (account !== goal.accountId) edit.accountId = account;
    if (Object.keys(edit).length > 1) steps.push({ name: "goals.edit", input: edit });
    if ((deadline || null) !== goal.plan.deadline) steps.push({ name: "goals.setDeadline", input: { goalId: goal.goalId, deadline: deadline || null } });
    if (contribCents !== goal.plan.expectedContributionCents || (contribCents !== null && period !== goal.plan.contributionPeriod)) {
      steps.push({ name: "goals.setContribution", input: { goalId: goal.goalId, expectedContributionCents: contribCents, contributionPeriod: contribCents === null ? null : period } });
    }
    if (priority && Number(priority) !== goal.priority && account === goal.accountId) {
      const order = siblings.filter((s) => s.accountId === goal.accountId).sort((a, b) => a.priority - b.priority).map((s) => s.goalId).filter((id) => id !== goal.goalId);
      order.splice(Math.min(Number(priority) - 1, order.length), 0, goal.goalId);
      steps.push({ name: "goals.reorder", input: { accountId: goal.accountId, goalIds: order } });
    }
    if (steps.length === 0) return onClose();
    setPending({ title: `Edit "${goal.name}"`, steps });
  };

  return (
    <div className="ui-confirm" role="dialog" aria-modal="true" aria-label={goal ? `Edit ${goal.name}` : "Add a goal"}>
      <form className="ui-confirm__card gl-form" onSubmit={submit}>
        <h3 className="ui-confirm__title">{goal ? `Edit "${goal.name}"` : "Add a goal"}</h3>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="DGX Spark" required />
        <div className="gl-form__row">
          <Input label="Target ($)" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required error={target && (targetCents === null || targetCents === 0) ? "Enter an amount over $0" : undefined} />
          <Select label="Account" value={account} onChange={(e) => setAccountId(e.target.value)} hint={usable.length === 0 ? "Connect a savings account first." : undefined}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.balanceCents !== null ? ` · ${usd(a.balanceCents)}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <Select label="Priority on this account" value={priority} onChange={(e) => setPriority(e.target.value)} hint="Money fills goals in priority order, after any protected amount.">
          <option value="">{goal ? `Keep #${goal.priority}` : `Last (#${onAccount.length + 1})`}</option>
          {Array.from({ length: onAccount.length + 1 }, (_, i) => (
            <option key={i} value={i + 1}>
              #{i + 1}
              {onAccount[i] ? ` (before ${onAccount[i].name})` : ""}
            </option>
          ))}
        </Select>
        <Input label="Deadline (optional)" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} hint={deadline ? `Shows what's needed per month to hit ${longDate(deadline)}.` : undefined} />
        <div className="gl-form__row">
          <Input label="Expected contribution ($, optional)" inputMode="decimal" value={contribution} onChange={(e) => setContribution(e.target.value)} error={contribBad ? "Enter an amount over $0, or leave it empty" : undefined} />
          <Select label="Per" value={period} onChange={(e) => setPeriod(e.target.value as ContributionPeriod)} disabled={!contribution.trim()}>
            <option value="weekly">Week</option>
            <option value="monthly">Month</option>
            <option value="yearly">Year</option>
          </Select>
        </div>
        <div className="ui-confirm__buttons">
          {goal && (
            <Button variant="danger" className="bg-editor__delete" onClick={() => setPending({ title: `Delete "${goal.name}"`, steps: [{ name: "goals.delete", input: { goalId: goal.goalId } }], destructive: true })}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!valid}>
            Review changes
          </Button>
        </div>
      </form>
    </div>
  );
}

interface TxRow {
  transactionId: string;
  date: string;
  merchantName: string;
  amountCents: number;
  accountName: string;
}

/** Link a completed goal to the transaction that bought the thing. */
export function LinkPurchase({ goalId, name, targetCents, onClose }: { goalId: string; name: string; targetCents: number; onClose: () => void }) {
  const [text, setText] = useState(name);
  const [chosen, setChosen] = useState<TxRow | null>(null);
  const q = useQuery<{ rows: TxRow[] }>("transactions.list", { text: text.trim() || undefined, buckets: ["spending"], measure: "spend", limit: 20, offset: 0 });
  if (chosen) {
    return (
      <ActionConfirm
        title={`Link "${name}" to its purchase`}
        steps={[{ name: "goals.linkPurchase", input: { goalId, transactionId: chosen.transactionId } }]}
        onCancel={() => setChosen(null)}
        onDone={onClose}
      />
    );
  }
  return (
    <div className="ui-confirm" role="dialog" aria-modal="true" aria-label={`Link ${name} to its purchase`}>
      <div className="ui-confirm__card gl-form">
        <h3 className="ui-confirm__title">Which purchase was "{name}"?</h3>
        <Input label="Search transactions" value={text} onChange={(e) => setText(e.target.value)} hint={`Target was ${usd(targetCents)}. Search by merchant, description or amount.`} />
        <ul className="gl-txlist">
          {(q.data?.value.rows ?? []).map((r) => (
            <li key={r.transactionId}>
              <button type="button" className="gl-txrow" onClick={() => setChosen(r)}>
                <span>{r.merchantName}</span>
                <span className="gl-muted">
                  {longDate(r.date)} · {r.accountName}
                </span>
                <strong>{usd(-r.amountCents)}</strong>
              </button>
            </li>
          ))}
          {q.data && q.data.value.rows.length === 0 && <li className="gl-muted">No matching purchases.</li>}
        </ul>
        <div className="ui-confirm__buttons">
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
