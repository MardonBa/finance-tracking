/**
 * Dev-only styleguide (§15): every shared component in every state, the
 * palette, the type scale, the chart theme and the colour map. Open with
 * `#styleguide` in a dev build; it is not bundled in production.
 */
import { useState, type ReactNode } from "react";
import { Money } from "@ft/core";
import { Chart } from "./Chart.tsx";
import { buildColorMap, foldOther, goalColorMap } from "./colorMap.ts";
import {
  Button,
  Card,
  DockItem,
  DraggableCard,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  StatNumber,
  StatusLabel,
  Tabs,
  Toggle,
  Tooltip,
} from "./components.tsx";
import { contrastRatio } from "./contrast.ts";
import { Icon, iconNames } from "./Icon.tsx";
import { color, seriesColors, type ColorToken } from "./tokens.ts";
import "./styleguide.css";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sg-section">
      <h2 className="sg-section__title">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sg-row">
      <span className="sg-row__label">{label}</span>
      <div className="sg-row__items">{children}</div>
    </div>
  );
}

const STATES = [
  { label: "default", className: "" },
  { label: "hover", className: "is-hover" },
  { label: "focus", className: "is-focus-visible" },
  { label: "pressed", className: "is-pressed" },
] as const;

const categories = [
  { key: "rent", label: "Rent", value: 210_000 },
  { key: "groceries", label: "Groceries", value: 64_000 },
  { key: "dining", label: "Dining", value: 41_000 },
  { key: "travel", label: "Travel", value: 30_000 },
  { key: "transport", label: "Transport", value: 18_000 },
  { key: "shopping", label: "Shopping", value: 15_000 },
  { key: "pets", label: "Pets", value: 4_000 },
  { key: "gifts", label: "Gifts", value: 2_500 },
];

export default function Styleguide() {
  const [toggle, setToggle] = useState(true);
  const [tab, setTab] = useState<"month" | "year" | "all">("month");
  const [seg, setSeg] = useState<"list" | "calendar">("list");
  const [goals, setGoals] = useState(["Emergency fund", "Japan trip", "New laptop"]);
  const colorMap = buildColorMap(categories);
  const pie = foldOther(categories, colorMap);
  const goalColors = goalColorMap(["g1", "g2", "g3"]);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= goals.length) return;
    const next = [...goals];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setGoals(next);
  };

  return (
    <div className="sg">
      <header className="sg-header">
        <h1>Styleguide</h1>
        <p>Dev only. Every control: default, hover, keyboard focus, pressed, disabled. Tab through the page to try focus live.</p>
      </header>

      <Section title="Palette">
        <div className="sg-swatches">
          {(Object.keys(color) as ColorToken[]).map((name) => (
            <div key={name} className="sg-swatch">
              <span className="sg-swatch__chip" style={{ background: `var(--${name})` }} />
              <code>--{name}</code>
              <span className="sg-swatch__meta">{contrastRatio(color[name], color["surface-cream"]).toFixed(2)}:1 on cream</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="sg-type">
          <StatNumber label="Net worth (2xl, the one primary number)" value={Money.format(12_345_678)} size="lg" />
          <StatNumber label="Card figure (xl)" value={Money.format(-48_210)} detail="+$120 vs last month" />
          <p style={{ fontSize: "var(--text-lg)", color: "var(--text-strong)", margin: 0 }}>Window title, lg 20</p>
          <p style={{ fontSize: "var(--text-md)", margin: 0 }}>Body, md 16</p>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: 0 }}>Label, sm 14</p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: 0 }}>Caption, xs 12</p>
        </div>
      </Section>

      <Section title="Button">
        {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            {STATES.map((s) => (
              <Button key={s.label} variant={variant} className={s.className} icon={variant === "primary" ? "plus" : undefined}>
                {s.label}
              </Button>
            ))}
            <Button variant={variant} disabled>
              disabled
            </Button>
          </Row>
        ))}
        <Row label="sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
        </Row>
      </Section>

      <Section title="IconButton + Tooltip">
        <Row label="states">
          {STATES.map((s) => (
            <IconButton key={s.label} icon="plus" label={`Add (${s.label})`} className={s.className} />
          ))}
          <IconButton icon="plus" label="Add (disabled)" disabled />
          <IconButton icon="close" size="sm" label="Close" />
          <IconButton icon="minimize" size="sm" label="Minimise" />
          <IconButton icon="maximize" size="sm" label="Maximise" />
        </Row>
        <Row label="tooltip">
          <Tooltip label="Tooltips appear on hover and keyboard focus">
            <Button>Hover or focus me</Button>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Toggle">
        <Row label="states">
          <Toggle checked={toggle} onChange={setToggle} label="Adjust for inflation" />
          <Toggle checked={false} onChange={() => undefined} label="Off" />
          <Toggle checked disabled onChange={() => undefined} label="Disabled on" />
          <Toggle checked={false} disabled onChange={() => undefined} label="Disabled off" />
        </Row>
      </Section>

      <Section title="Tabs and SegmentedControl">
        <Row label="tabs">
          <Tabs
            label="Period"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "month", label: "This month" },
              { value: "year", label: "This year" },
              { value: "all", label: "All time", disabled: true },
            ]}
          />
        </Row>
        <Row label="segmented">
          <SegmentedControl
            label="View"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "list", label: "List", icon: "transactions" },
              { value: "calendar", label: "Calendar", icon: "recurring" },
            ]}
          />
          <SegmentedControl
            label="Small"
            size="sm"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "list", label: "List" },
              { value: "calendar", label: "Calendar" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Card and DraggableCard">
        <div className="sg-grid">
          <Card title="Card" actions={<IconButton icon="info" size="sm" label="About this card" />}>
            <StatNumber label="Safe to spend" value={Money.format(84_250)} onDrillDown={() => undefined} />
          </Card>
          <div className="sg-stack">
            {goals.map((g, i) => (
              <DraggableCard key={g} label={g} position={`priority ${i + 1} of ${goals.length}`} onMove={(d) => move(i, d)}>
                <span className="sg-goal">
                  <span className="sg-dot" style={{ background: goalColors.get(`g${i + 1}`) }} />
                  {g}
                </span>
              </DraggableCard>
            ))}
            <DraggableCard label="Dragging" dragging>
              Dragging state
            </DraggableCard>
            <DraggableCard label="Disabled" disabled>
              Disabled state
            </DraggableCard>
          </div>
        </div>
      </Section>

      <Section title="DockItem">
        <Row label="states">
          <DockItem icon="overview" label="Closed" state="closed" onClick={() => undefined} />
          <DockItem icon="spending" label="Open" state="open" onClick={() => undefined} />
          <DockItem icon="goals" label="Focused" state="open" focused onClick={() => undefined} />
          <DockItem icon="budgets" label="Minimised" state="minimized" onClick={() => undefined} />
          <DockItem icon="assistant" label="Disabled" state="closed" disabled onClick={() => undefined} />
        </Row>
      </Section>

      <Section title="Input and Select">
        <div className="sg-grid">
          <Input label="Goal name" placeholder="e.g. Japan trip" />
          <Input label="Target" hint="In dollars" defaultValue="4,000" />
          <Input label="With an error" error="Enter an amount above zero" defaultValue="-5" />
          <Input label="Disabled" disabled defaultValue="Read only" />
          <Select label="Category" defaultValue="groceries">
            <option value="groceries">Groceries</option>
            <option value="dining">Dining</option>
          </Select>
          <Select label="Disabled select" disabled>
            <option>Locked</option>
          </Select>
        </div>
      </Section>

      <Section title="StatusLabel (icon + text, never colour alone)">
        <Row label="statuses">
          <StatusLabel status="over">Over by $42</StatusLabel>
          <StatusLabel status="under" />
          <StatusLabel status="on-track" />
          <StatusLabel status="warning" />
        </Row>
      </Section>

      <Section title="EmptyState">
        <Card>
          <EmptyState icon="goals" title="No goals yet" description="Set a savings goal to see how funded it is." action={{ label: "Add a goal", icon: "plus", onClick: () => undefined }} />
        </Card>
      </Section>

      <Section title="Chart theme + colour map">
        <div className="sg-grid">
          <Card title="Spending by category (top 6 named, rest share Other)" padding="md">
            <div style={{ height: 240 }}>
              <Chart
                ariaLabel="Spending by category"
                option={{
                  tooltip: { trigger: "item" },
                  series: [
                    {
                      type: "pie",
                      radius: ["45%", "75%"],
                      data: pie.map((p) => ({ name: p.label, value: p.value / 100, itemStyle: { color: p.color } })),
                    },
                  ],
                }}
              />
            </div>
          </Card>
          <Card title="Monthly spending" padding="md">
            <div style={{ height: 240 }}>
              <Chart
                ariaLabel="Monthly spending by series"
                option={{
                  tooltip: { trigger: "axis" },
                  legend: { bottom: 0 },
                  xAxis: { type: "category", data: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"] },
                  yAxis: { type: "value" },
                  series: seriesColors.slice(0, 3).map((_, i) => ({
                    type: i === 0 ? "bar" : "line",
                    name: ["Spending", "Budget", "Last year"][i],
                    data: [12, 15, 11, 18, 14, 16].map((v) => v * 100 + i * 150),
                  })),
                }}
              />
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Icons">
        <div className="sg-icons">
          {iconNames.map((n) => (
            <span key={n} className="sg-icon">
              <Icon name={n} size={20} />
              <code>{n}</code>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
