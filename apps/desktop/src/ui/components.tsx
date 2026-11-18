/**
 * The shared raised component set (§15). Every interactive surface in the
 * app uses these, so the raised look (hard offset shadow that collapses as
 * the element moves down on press) and the hover / keyboard-focus / pressed
 * / disabled states stay identical everywhere. Styles: components.css.
 */
import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "./components.css";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ Tooltip */

export interface TooltipProps {
  /** Text shown on hover and keyboard focus. */
  label: string;
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
}

/** Shows `label` on hover or focus-within; links it with aria-describedby. */
export function Tooltip({ label, children, placement = "top" }: TooltipProps) {
  const id = useId();
  return (
    <span className="ui-tooltip-anchor" aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={cx("ui-tooltip", `ui-tooltip--${placement}`)}>
        {label}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------- Button */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  /** Force the pressed look (e.g. a toggled toolbar button). */
  pressed?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, pressed, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("ui-raised", "ui-button", `ui-button--${variant}`, `ui-button--${size}`, pressed && "is-pressed", className)}
      aria-pressed={pressed}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/* --------------------------------------------------------------- IconButton */

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: the accessible name and the tooltip text. */
  label: string;
  size?: "sm" | "md";
  tooltipPlacement?: TooltipProps["placement"];
  /** Suppress the tooltip (e.g. title-bar buttons where it would flicker). */
  noTooltip?: boolean;
}

export function IconButton({ icon, label, size = "md", tooltipPlacement, noTooltip, className, type = "button", ...rest }: IconButtonProps) {
  const button = (
    <button type={type} aria-label={label} className={cx("ui-raised", "ui-icon-button", `ui-icon-button--${size}`, className)} {...rest}>
      <Icon name={icon} size={size === "sm" ? 12 : 18} />
    </button>
  );
  return noTooltip ? button : <Tooltip label={label} placement={tooltipPlacement}>{button}</Tooltip>;
}

/* ------------------------------------------------------------------- Toggle */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
}

export function Toggle({ checked, onChange, label, disabled, hideLabel }: ToggleProps) {
  return (
    <label className={cx("ui-toggle", disabled && "is-disabled")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={cx("ui-raised", "ui-toggle__track", checked && "is-on")}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle__thumb" />
      </button>
      <span className={cx("ui-toggle__label", hideLabel && "ui-visually-hidden")}>{label}</span>
    </label>
  );
}

/* ---------------------------------------------- Tabs and SegmentedControl */

export interface Option<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

function moveFocus<V extends string>(e: KeyboardEvent, options: readonly Option<V>[], current: V, onChange: (v: V) => void) {
  const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const enabled = options.filter((o) => !o.disabled);
  const i = enabled.findIndex((o) => o.value === current);
  let next = i;
  if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
  if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
  if (e.key === "Home") next = 0;
  if (e.key === "End") next = enabled.length - 1;
  const target = enabled[next];
  if (!target) return;
  onChange(target.value);
  const container = e.currentTarget as HTMLElement;
  requestAnimationFrame(() => container.querySelector<HTMLElement>(`[data-value="${CSS.escape(target.value)}"]`)?.focus());
}

export interface TabsProps<V extends string> {
  tabs: readonly Option<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}

/** Tab strip (role=tablist). The panel is the caller's; give it aria-labelledby={`tab-${value}`}. */
export function Tabs<V extends string>({ tabs, value, onChange, label }: TabsProps<V>) {
  return (
    <div role="tablist" aria-label={label} className="ui-tabs" onKeyDown={(e) => moveFocus(e, tabs, value, onChange)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          id={`tab-${t.value}`}
          type="button"
          role="tab"
          data-value={t.value}
          aria-selected={t.value === value}
          tabIndex={t.value === value ? 0 : -1}
          disabled={t.disabled}
          className={cx("ui-raised", "ui-tab", t.value === value && "is-selected")}
          onClick={() => onChange(t.value)}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface SegmentedControlProps<V extends string> {
  options: readonly Option<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  size?: "sm" | "md";
}

export function SegmentedControl<V extends string>({ options, value, onChange, label, size = "md" }: SegmentedControlProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("ui-raised", "ui-segmented", `ui-segmented--${size}`)}
      onKeyDown={(e) => moveFocus(e, options, value, onChange)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          className={cx("ui-segment", o.value === value && "is-selected")}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------ Card / DraggableCard */

export interface CardProps {
  title?: string;
  /** Right side of the header (e.g. an IconButton). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: "none" | "md";
}

/** Static white surface. Not interactive: no pressed state. */
export function Card({ title, actions, children, className, padding = "md" }: CardProps) {
  return (
    <section className={cx("ui-card", padding === "none" && "ui-card--flush", className)}>
      {(title || actions) && (
        <header className="ui-card__header">
          {title && <h3 className="ui-card__title">{title}</h3>}
          {actions && <div className="ui-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export interface DraggableCardProps {
  /** Announced name, e.g. the goal's name. */
  label: string;
  children: ReactNode;
  dragging?: boolean;
  disabled?: boolean;
  /** Keyboard reorder: ArrowUp / ArrowDown on the handle call this with -1 / +1. */
  onMove?: (delta: -1 | 1) => void;
  /** Pointer drag start on the handle (the list owner tracks the pointer). */
  onDragStart?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  /** e.g. "Priority 2 of 5", announced with the handle. */
  position?: string;
}

/** A raised card with a grip handle; lifts while dragging and presses on grab. */
export function DraggableCard({ label, children, dragging, disabled, onMove, onDragStart, position }: DraggableCardProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!onMove) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onMove(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMove(1);
    }
  };
  return (
    <div className={cx("ui-raised", "ui-draggable-card", dragging && "is-dragging", disabled && "is-disabled")}>
      <button
        type="button"
        className="ui-draggable-card__handle"
        aria-label={`Reorder ${label}${position ? `, ${position}` : ""}. Use the up and down arrow keys to move.`}
        aria-roledescription="draggable"
        disabled={disabled}
        onKeyDown={onKeyDown}
        onPointerDown={onDragStart}
      >
        <Icon name="grip" size={18} />
      </button>
      <div className="ui-draggable-card__body">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- DockItem */

export interface DockItemProps {
  icon: IconName;
  label: string;
  /** Shortcut hint shown in the tooltip, e.g. "⌘1". */
  shortcut?: string;
  /** Extra tooltip text, e.g. the question the window answers. */
  description?: string;
  state: "closed" | "open" | "minimized";
  focused?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function DockItem({ icon, label, shortcut, description, state, focused, onClick, disabled }: DockItemProps) {
  const status = state === "minimized" ? "minimised" : state === "open" ? "open" : "";
  const tip = `${shortcut ? `${label} (${shortcut})` : label}${description ? ` · ${description}` : ""}`;
  return (
    <Tooltip label={tip} placement="top">
      <button
        type="button"
        className={cx("ui-raised", "ui-dock-item", `is-${state}`, focused && "is-focused")}
        aria-label={status ? `${label}, ${status}` : label}
        aria-current={focused ? "true" : undefined}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon name={icon} size={22} />
        <span className="ui-dock-item__label">{label}</span>
        <span className="ui-dock-item__indicator" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------ Input, Select */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, className, id, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx("ui-field", error && "has-error", className)}>
      <label htmlFor={inputId} className="ui-field__label">
        {label}
      </label>
      <input id={inputId} className="ui-input" aria-invalid={!!error} aria-describedby={hint || error ? hintId : undefined} {...rest} />
      {(error || hint) && (
        <p id={hintId} className="ui-field__hint">
          {error && <Icon name="warning" size={14} />}
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = `${selectId}-hint`;
  return (
    <div className={cx("ui-field", error && "has-error", className)}>
      <label htmlFor={selectId} className="ui-field__label">
        {label}
      </label>
      <div className="ui-select">
        <select id={selectId} className="ui-raised ui-select__control" aria-invalid={!!error} aria-describedby={hint || error ? hintId : undefined} {...rest}>
          {children}
        </select>
        <Icon name="chevronDown" size={16} className="ui-select__chevron" />
      </div>
      {(error || hint) && (
        <p id={hintId} className="ui-field__hint">
          {error && <Icon name="warning" size={14} />}
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- EmptyState */

export interface EmptyStateProps {
  icon?: IconName;
  /** What goes here, e.g. "No goals yet". */
  title: string;
  description?: string;
  /** The next step, e.g. { label: "Add a goal", onClick }. */
  action?: { label: string; onClick: () => void; icon?: IconName; disabled?: boolean };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      {icon && (
        <span className="ui-empty__icon">
          <Icon name={icon} size={28} />
        </span>
      )}
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {action && (
        <Button variant="primary" icon={action.icon} onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- StatNumber */

export interface StatNumberProps {
  label: string;
  /** Already formatted, e.g. Money.format(cents). */
  value: string;
  size?: "md" | "lg";
  /** Secondary line under the number, e.g. "+$120 vs last month". */
  detail?: ReactNode;
  /** Clicking a number always drills down to its transactions (§15). */
  onDrillDown?: () => void;
}

export function StatNumber({ label, value, size = "md", detail, onDrillDown }: StatNumberProps) {
  const number = <span className={cx("ui-stat__value", `ui-stat__value--${size}`)}>{value}</span>;
  return (
    <div className="ui-stat">
      <span className="ui-stat__label">{label}</span>
      {onDrillDown ? (
        <button type="button" className="ui-stat__drill" onClick={onDrillDown} aria-label={`${label}: ${value}. Show transactions`}>
          {number}
        </button>
      ) : (
        number
      )}
      {detail && <span className="ui-stat__detail">{detail}</span>}
    </div>
  );
}

/* -------------------------------------------------------------- StatusLabel */

export type Status = "over" | "under" | "on-track" | "warning";

const STATUS: Record<Status, { icon: IconName; text: string }> = {
  over: { icon: "arrowUp", text: "Over" },
  under: { icon: "arrowDown", text: "Under" },
  "on-track": { icon: "check", text: "On track" },
  warning: { icon: "warning", text: "Needs a look" },
};

/** Status is never colour alone: always an icon AND text. */
export function StatusLabel({ status, children }: { status: Status; children?: ReactNode }) {
  const s = STATUS[status];
  return (
    <span className={cx("ui-status", `ui-status--${status}`)}>
      <Icon name={s.icon} size={14} />
      <span>{children ?? s.text}</span>
    </span>
  );
}
