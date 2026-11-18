/**
 * Drag-to-reorder goal priorities (design.md §5, ideas.md): raised cards with
 * a grip handle, a lifted state while dragging, a drop indicator, smooth
 * reflow of the other cards, and keyboard arrows on the handle. While
 * dragging, `onPreview` reports the order the drop would give, so projected
 * dates update live.
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { DraggableCard } from "../../ui/components.tsx";

export interface ReorderItem {
  id: string;
  label: string;
}

export interface ReorderListProps<T extends ReorderItem> {
  items: T[];
  /** Called on drop (pointer) or each arrow-key move with the full new order. */
  onCommit: (ids: string[]) => void;
  /** The order a drop would give right now (null when not dragging). */
  onPreview?: (ids: string[] | null) => void;
  render: (item: T, index: number) => ReactNode;
  label: string;
}

interface Drag {
  id: string;
  from: number;
  startY: number;
  dy: number;
  rects: { top: number; height: number }[];
  listTop: number;
  target: number;
}

const GAP = 8;

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}

function targetIndex(d: Pick<Drag, "from" | "dy" | "rects">): number {
  const me = d.rects[d.from]!;
  const center = me.top + me.height / 2 + d.dy;
  let t = 0;
  d.rects.forEach((r, i) => {
    if (i !== d.from && r.top + r.height / 2 < center) t++;
  });
  return t;
}

export function ReorderList<T extends ReorderItem>({ items, onCommit, onPreview, render, label }: ReorderListProps<T>) {
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState("");
  const refs = useRef(new Map<string, HTMLLIElement>());
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // Follow the server's order whenever we're not dragging.
  const serverKey = items.map((i) => i.id).join(",");
  useEffect(() => {
    if (!dragRef.current) setOrder(serverKey ? serverKey.split(",") : []);
  }, [serverKey]);

  useLayoutEffect(() => {
    if (!focusAfter.current) return;
    refs.current.get(focusAfter.current)?.querySelector<HTMLButtonElement>(".ui-draggable-card__handle")?.focus();
    focusAfter.current = null;
  });

  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = order.filter((id) => byId.has(id));

  const startDrag = (id: string, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rects = shown.map((x) => {
      const r = refs.current.get(x)?.getBoundingClientRect();
      return { top: r?.top ?? 0, height: r?.height ?? 0 };
    });
    const from = shown.indexOf(id);
    const d: Drag = { id, from, startY: e.clientY, dy: 0, rects, listTop: listRef.current?.getBoundingClientRect().top ?? 0, target: from };
    setDrag(d);
    onPreview?.(shown);

    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const next = { ...cur, dy: ev.clientY - cur.startY };
      next.target = targetIndex(next);
      if (next.target !== cur.target) onPreview?.(moveItem(shown, cur.from, next.target));
      dragRef.current = next;
      setDrag(next);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      onPreview?.(null);
      if (!cur || ev.type === "pointercancel" || cur.target === cur.from) return;
      const next = moveItem(shown, cur.from, cur.target);
      setOrder(next);
      setAnnounce(`${byId.get(cur.id)?.label} moved to priority ${cur.target + 1} of ${shown.length}.`);
      onCommit(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const keyMove = (id: string, delta: -1 | 1) => {
    const from = shown.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= shown.length) return;
    const next = moveItem(shown, from, to);
    setOrder(next);
    focusAfter.current = id;
    setAnnounce(`${byId.get(id)?.label} moved to priority ${to + 1} of ${shown.length}.`);
    onCommit(next);
  };

  // Where the dragged card will land, for the drop indicator.
  let indicatorTop: number | null = null;
  if (drag && drag.target !== drag.from) {
    const t = drag.rects[drag.target]!;
    // Above the card it displaces when moving up, below it when moving down.
    indicatorTop = (drag.target < drag.from ? t.top - GAP / 2 : t.top + t.height + GAP / 2) - drag.listTop - 2;
  }

  const shift = (i: number): number => {
    if (!drag) return 0;
    const h = (drag.rects[drag.from]?.height ?? 0) + GAP;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.target && i > drag.from && i <= drag.target) return -h;
    if (drag.target < drag.from && i >= drag.target && i < drag.from) return h;
    return 0;
  };

  return (
    <div className={`gl-reorder${drag ? " is-dragging" : ""}`}>
      <ol className="gl-reorder__list" ref={listRef} aria-label={label}>
        {shown.map((id, i) => {
          const item = byId.get(id)!;
          const isDragged = drag?.id === id;
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              data-index={i}
              data-testid={`reorder-${id}`}
              className={`gl-reorder__item${isDragged ? " is-lifted" : ""}`}
              style={{ transform: `translateY(${shift(i)}px)` }}
            >
              <DraggableCard
                label={item.label}
                position={`priority ${i + 1} of ${shown.length}`}
                dragging={isDragged}
                onMove={(d) => keyMove(id, d)}
                onDragStart={(e) => startDrag(id, e)}
              >
                {render(item, i)}
              </DraggableCard>
            </li>
          );
        })}
      </ol>
      {indicatorTop !== null && <div className="gl-drop" style={{ top: indicatorTop }} aria-hidden="true" data-testid="drop-indicator" />}
      <p className="ui-visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
