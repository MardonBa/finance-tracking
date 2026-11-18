/**
 * Create/edit the budget, its parts and trips (§10). Every change goes
 * through registry actions with a before → after preview (ActionConfirm).
 */
import { useMemo, useState, type FormEvent } from "react";
import type { BudgetPartTargetKind, BudgetPeriodKind } from "@ft/core";
import { Button, Input, SegmentedControl, Select } from "../../ui/components.tsx";
import { ActionConfirm, type ActionStep } from "../../ui/ActionConfirm.tsx";
import { dollarsText, parseDollars } from "./format.ts";

type Choice = { value: string; label: string };

export interface ConfigValue {
  budgets: {
    budgetId: string;
    name: string;
    periodKind: BudgetPeriodKind;
    anchorDate: string;
    customEndDate: string | null;
    period: { start: string; end: string };
    amountCents: number | null;
    parts: { partId: string; name: string; expectedCents: number; position: number; targets: { kind: BudgetPartTargetKind; value: string }[] }[];
  }[];
  trips: { id: string; name: string; startDate: string; endDate: string; expectedCents: number; tagId: string; tagName: string | null }[];
  choices: { categories: Choice[]; merchants: Choice[]; tags: Choice[] };
}

export type EditTarget =
  | { kind: "budget"; budgetId?: string }
  | { kind: "part"; budgetId: string; partId?: string }
  | { kind: "trip"; tripId?: string };

export interface BudgetEditorProps {
  target: EditTarget;
  config: ConfigValue;
  /** Category code → readable label (core's categoryLabel). */
  categoryLabel: (code: string) => string;
  onClose: () => void;
}

const PERIODS: { value: BudgetPeriodKind; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom dates" },
];

export function BudgetEditor({ target, config, categoryLabel, onClose }: BudgetEditorProps) {
  const [steps, setSteps] = useState<{ title: string; steps: ActionStep[]; destructive?: boolean } | null>(null);
  if (steps) {
    return <ActionConfirm title={steps.title} steps={steps.steps} destructive={steps.destructive} confirmLabel={steps.destructive ? "Delete" : "Save"} onCancel={() => setSteps(null)} onDone={onClose} />;
  }
  return (
    <div className="ui-confirm" role="dialog" aria-modal="true" aria-label="Edit budget">
      <div className="ui-confirm__card bg-editor">
        {target.kind === "budget" && <BudgetForm target={target} config={config} onClose={onClose} onSubmit={setSteps} />}
        {target.kind === "part" && <PartForm target={target} config={config} categoryLabel={categoryLabel} onClose={onClose} onSubmit={setSteps} />}
        {target.kind === "trip" && <TripForm target={target} config={config} onClose={onClose} onSubmit={setSteps} />}
      </div>
    </div>
  );
}

type Submit = (s: { title: string; steps: ActionStep[]; destructive?: boolean }) => void;

function FormButtons({ onClose, onDelete, disabled }: { onClose: () => void; onDelete?: () => void; disabled?: boolean }) {
  return (
    <div className="ui-confirm__buttons">
      {onDelete && (
        <Button variant="danger" onClick={onDelete} className="bg-editor__delete">
          Delete
        </Button>
      )}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={disabled}>
        Review changes
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- budget

function BudgetForm({ target, config, onClose, onSubmit }: { target: Extract<EditTarget, { kind: "budget" }>; config: ConfigValue; onClose: () => void; onSubmit: Submit }) {
  const b = config.budgets.find((x) => x.budgetId === target.budgetId);
  const [name, setName] = useState(b?.name ?? "Monthly spending");
  const [amount, setAmount] = useState(dollarsText(b?.amountCents));
  const [periodKind, setPeriodKind] = useState<BudgetPeriodKind>(b?.periodKind ?? "monthly");
  const [anchor, setAnchor] = useState(b?.anchorDate ?? "");
  const [end, setEnd] = useState(b?.customEndDate ?? "");
  const cents = parseDollars(amount);
  const needsDates = periodKind === "custom";
  const valid = name.trim() && cents !== null && (!needsDates || (anchor && end && end >= anchor));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || cents === null) return;
    if (!b) {
      onSubmit({
        title: "Create the budget",
        steps: [
          {
            name: "budgets.create",
            input: { name: name.trim(), amountCents: cents, periodKind, ...(anchor ? { anchorDate: anchor } : {}), customEndDate: needsDates ? end : null },
          },
        ],
      });
      return;
    }
    const input: Record<string, unknown> = { budgetId: b.budgetId };
    if (name.trim() !== b.name) input.name = name.trim();
    if (cents !== b.amountCents) input.amountCents = cents;
    if (periodKind !== b.periodKind) input.periodKind = periodKind;
    if (anchor && anchor !== b.anchorDate) input.anchorDate = anchor;
    if (needsDates && end !== (b.customEndDate ?? "")) input.customEndDate = end;
    onSubmit({ title: `Edit "${b.name}"`, steps: [{ name: "budgets.edit", input }] });
  };

  return (
    <form onSubmit={submit} className="bg-form">
      <h3 className="ui-confirm__title">{b ? "Edit the budget" : "Create a budget"}</h3>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Overall amount per period ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && cents === null ? "Enter an amount like 3200" : undefined} required />
      <Select label="Period" value={periodKind} onChange={(e) => setPeriodKind(e.target.value as BudgetPeriodKind)} hint="Each period starts fresh; nothing carries over.">
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <Input
        label={needsDates ? "Starts on" : "First period starts on (optional)"}
        type="date"
        value={anchor}
        onChange={(e) => setAnchor(e.target.value)}
        hint={needsDates ? undefined : periodKind === "monthly" ? "Default: the 1st, so periods are calendar months." : "Default: today."}
        required={needsDates}
      />
      {needsDates && <Input label="Ends on" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required error={end && anchor && end < anchor ? "Ends before it starts" : undefined} />}
      <FormButtons
        onClose={onClose}
        disabled={!valid}
        onDelete={b ? () => onSubmit({ title: `Delete "${b.name}"`, steps: [{ name: "budgets.delete", input: { budgetId: b.budgetId } }], destructive: true }) : undefined}
      />
    </form>
  );
}

// ---------------------------------------------------------------- part

const KIND_LABEL: Record<BudgetPartTargetKind, string> = { category: "Categories", merchant: "Merchants", tag: "Tag" };

function PartForm({
  target,
  config,
  categoryLabel,
  onClose,
  onSubmit,
}: {
  target: Extract<EditTarget, { kind: "part" }>;
  config: ConfigValue;
  categoryLabel: (c: string) => string;
  onClose: () => void;
  onSubmit: Submit;
}) {
  const budget = config.budgets.find((b) => b.budgetId === target.budgetId);
  const part = budget?.parts.find((p) => p.partId === target.partId);
  const [name, setName] = useState(part?.name ?? "");
  const [amount, setAmount] = useState(dollarsText(part?.expectedCents));
  const [kind, setKind] = useState<BudgetPartTargetKind>(part?.targets[0]?.kind ?? "category");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(part?.targets.map((t) => `${t.kind}|${t.value}`) ?? []));
  const [search, setSearch] = useState("");
  const cents = parseDollars(amount);

  const options: Choice[] = useMemo(() => {
    const raw = kind === "category" ? config.choices.categories.map((c) => ({ value: c.value, label: categoryLabel(c.value) })) : kind === "merchant" ? config.choices.merchants : config.choices.tags;
    // Keep current targets visible even if no spending uses them yet.
    const have = new Set(raw.map((r) => r.value));
    const extra = [...selected].filter((k) => k.startsWith(`${kind}|`) && !have.has(k.slice(kind.length + 1))).map((k) => {
      const value = k.slice(kind.length + 1);
      return { value, label: kind === "category" ? categoryLabel(value) : value.replace(/^auto:/, "") };
    });
    const all = [...extra, ...raw];
    const s = search.trim().toLowerCase();
    return s ? all.filter((o) => o.label.toLowerCase().includes(s)) : all;
  }, [kind, config.choices, categoryLabel, search, selected]);

  const ofKind = [...selected].filter((k) => k.startsWith(`${kind}|`));
  const toggle = (value: string) => {
    const k = `${kind}|${value}`;
    setSelected((cur) => {
      // A tag part covers one tag; the other kinds can list several.
      const next = new Set(kind === "tag" ? [...cur].filter((x) => !x.startsWith("tag|")) : cur);
      if (cur.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const valid = budget && name.trim() && cents !== null && ofKind.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !budget || cents === null) return;
    const targets = ofKind.map((k) => ({ kind, value: k.slice(kind.length + 1) }));
    if (!part) {
      onSubmit({ title: `Add "${name.trim()}"`, steps: [{ name: "budgets.createPart", input: { budgetId: budget.budgetId, name: name.trim(), expectedCents: cents, targets } }] });
      return;
    }
    const input: Record<string, unknown> = { partId: part.partId };
    if (name.trim() !== part.name) input.name = name.trim();
    if (cents !== part.expectedCents) input.expectedCents = cents;
    const before = part.targets.map((t) => `${t.kind}|${t.value}`).sort().join(",");
    if (before !== [...ofKind].sort().join(",")) input.targets = targets;
    onSubmit({ title: `Edit "${part.name}"`, steps: [{ name: "budgets.editPart", input }] });
  };

  return (
    <form onSubmit={submit} className="bg-form">
      <h3 className="ui-confirm__title">{part ? `Edit "${part.name}"` : "Add a part"}</h3>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Eating out" required />
      <Input label="Expected per period ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && cents === null ? "Enter an amount like 150" : undefined} required />
      <div className="ui-field">
        <span className="ui-field__label">Covers</span>
        <SegmentedControl
          label="What the part covers"
          size="sm"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setSearch("");
          }}
          options={(["category", "merchant", "tag"] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
        <p className="ui-field__hint">Each transaction counts toward one part only. A tag beats a merchant, and a merchant beats a category.</p>
      </div>
      {kind !== "tag" && <Input label={`Search ${KIND_LABEL[kind].toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />}
      <fieldset className="bg-choices">
        <legend className="ui-visually-hidden">{KIND_LABEL[kind]}</legend>
        {options.length === 0 && <p className="bg-muted">{kind === "tag" ? "No tags yet. Tag transactions in the Transactions window first." : "Nothing matches."}</p>}
        {options.slice(0, 60).map((o) => (
          <label key={o.value} className="bg-choice">
            <input type={kind === "tag" ? "radio" : "checkbox"} name="bg-target" checked={selected.has(`${kind}|${o.value}`)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <FormButtons
        onClose={onClose}
        disabled={!valid}
        onDelete={part ? () => onSubmit({ title: `Remove "${part.name}"`, steps: [{ name: "budgets.deletePart", input: { partId: part.partId } }], destructive: true }) : undefined}
      />
    </form>
  );
}

// ---------------------------------------------------------------- trip

function TripForm({ target, config, onClose, onSubmit }: { target: Extract<EditTarget, { kind: "trip" }>; config: ConfigValue; onClose: () => void; onSubmit: Submit }) {
  const trip = config.trips.find((t) => t.id === target.tripId);
  const [name, setName] = useState(trip?.name ?? "");
  const [start, setStart] = useState(trip?.startDate ?? "");
  const [end, setEnd] = useState(trip?.endDate ?? "");
  const [amount, setAmount] = useState(dollarsText(trip?.expectedCents));
  const [tagName, setTagName] = useState("");
  const cents = parseDollars(amount);
  const valid = name.trim() && start && end && end >= start && cents !== null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || cents === null) return;
    if (!trip) {
      onSubmit({
        title: `Create the trip "${name.trim()}"`,
        steps: [{ name: "budgets.createTrip", input: { name: name.trim(), startDate: start, endDate: end, expectedCents: cents, ...(tagName.trim() ? { tagName: tagName.trim() } : {}) } }],
      });
      return;
    }
    const input: Record<string, unknown> = { tripId: trip.id };
    if (name.trim() !== trip.name) input.name = name.trim();
    if (start !== trip.startDate) input.startDate = start;
    if (end !== trip.endDate) input.endDate = end;
    if (cents !== trip.expectedCents) input.expectedCents = cents;
    onSubmit({ title: `Edit the trip "${trip.name}"`, steps: [{ name: "budgets.editTrip", input }] });
  };

  return (
    <form onSubmit={submit} className="bg-form">
      <h3 className="ui-confirm__title">{trip ? `Edit "${trip.name}"` : "Add a trip"}</h3>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lisbon trip" required />
      <div className="bg-form__row">
        <Input label="Starts" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        <Input label="Ends" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required error={start && end && end < start ? "Ends before it starts" : undefined} />
      </div>
      <Input label="Expected total ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      {trip ? (
        <p className="ui-field__hint">Tag: {trip.tagName ?? "—"}. Transactions with this tag between the dates count toward the trip.</p>
      ) : (
        <Select label="Tag" value={tagName} onChange={(e) => setTagName(e.target.value)} hint="Transactions with this tag between the dates count toward the trip, and in each month's overall as a trip line.">
          <option value="">New tag named after the trip</option>
          {config.choices.tags.map((t) => (
            <option key={t.value} value={t.label}>
              {t.label}
            </option>
          ))}
        </Select>
      )}
      <FormButtons
        onClose={onClose}
        disabled={!valid}
        onDelete={trip ? () => onSubmit({ title: `Delete the trip "${trip.name}"`, steps: [{ name: "budgets.deleteTrip", input: { tripId: trip.id } }], destructive: true }) : undefined}
      />
    </form>
  );
}

