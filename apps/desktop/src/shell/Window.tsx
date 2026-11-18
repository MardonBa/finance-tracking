/**
 * One desktop window: title bar (drag, double-click to maximise), minimise /
 * maximise / close, eight resize handles, focus highlight, open / minimise /
 * restore animations.
 *
 * Smoothness (§14): while dragging or resizing, the frame is moved with a
 * CSS transform written straight to the DOM inside requestAnimationFrame;
 * React state (and so the window contents) is updated once, on release.
 * During a resize the body's content keeps its starting size (clipped), so
 * charts relayout once at the end instead of every frame.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from "react";
import { IconButton } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { AREA_INFO, type AreaId, type Size } from "./areas.ts";
import { WindowContext, type ShellActions } from "./context.ts";
import { windowComponent } from "./windows.ts";
import { clampRect, resizeRect, type Edge, type Rect, type WindowState, type WMAction } from "./wm/state.ts";

const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "opening" | "idle" | "minimizing" | "restoring";

/** The content, isolated so moving/resizing/focusing never re-renders it. */
const WindowBody = memo(function WindowBody({ area, token, actions }: { area: AreaId; token: string; actions: ShellActions }) {
  const Content = windowComponent(area);
  const value = useMemo(() => ({ area, token, ...actions }), [area, token, actions]);
  return (
    <WindowContext.Provider value={value}>
      <Content />
    </WindowContext.Provider>
  );
});

export interface WindowProps {
  win: WindowState;
  focused: boolean;
  zIndex: number;
  viewport: Size;
  token: string;
  actions: ShellActions;
  dispatch: Dispatch<WMAction>;
}

export const Window = memo(function Window({ win, focused, zIndex, viewport, token, actions, dispatch }: WindowProps) {
  const { area } = win;
  const info = AREA_INFO[area];
  const outerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? "idle" : "opening"));
  const [interacting, setInteracting] = useState<"drag" | "resize" | null>(null);
  const wasMinimized = useRef(win.minimized);
  const titleId = `wm-title-${area}`;

  // Coming back from the dock plays the restore animation.
  useLayoutEffect(() => {
    if (wasMinimized.current && !win.minimized && !prefersReducedMotion()) setPhase("restoring");
    wasMinimized.current = win.minimized;
  }, [win.minimized]);

  // Safety net in case animationend never fires (e.g. the window is hidden).
  useEffect(() => {
    if (phase === "idle") return;
    const t = setTimeout(() => finishPhase(phase), 450);
    return () => clearTimeout(t);
  });

  function finishPhase(p: Phase) {
    if (p === "minimizing") dispatch({ type: "minimize", area });
    setPhase("idle");
  }

  const minimize = () => {
    if (prefersReducedMotion()) dispatch({ type: "minimize", area });
    else setPhase("minimizing");
  };

  const applyRect = (r: Rect) => {
    const el = outerRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  /** Shared pointer-tracking for drag and resize: rAF-throttled DOM writes, one dispatch at the end. */
  function track(e: ReactPointerEvent<HTMLElement>, kind: "drag" | "resize", compute: (dx: number, dy: number) => Rect, onEnd: (r: Rect) => void) {
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    let last: Rect | null = null;
    let raf = 0;
    target.setPointerCapture(pointerId);
    setInteracting(kind);
    if (kind === "resize" && contentRef.current) {
      const c = contentRef.current;
      c.style.width = `${c.offsetWidth}px`;
      c.style.height = `${c.offsetHeight}px`;
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      last = compute(ev.clientX - sx, ev.clientY - sy);
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (last) applyRect(last);
        });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (raf) cancelAnimationFrame(raf);
      if (contentRef.current) {
        contentRef.current.style.width = "";
        contentRef.current.style.height = "";
      }
      setInteracting(null);
      if (last) {
        applyRect(last);
        onEnd(last);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  const onTitlePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    // A maximised window comes off the edge at its restore size, under the cursor.
    const size = win.maximized && win.restore ? { w: win.restore.w, h: win.restore.h } : { w: win.w, h: win.h };
    const grabX = win.maximized ? size.w * ((e.clientX - (outerRef.current?.getBoundingClientRect().left ?? 0)) / win.w) : 0;
    const desktopLeft = outerRef.current?.parentElement?.getBoundingClientRect().left ?? 0;
    const start = win.maximized ? { x: e.clientX - desktopLeft - grabX, y: win.y } : { x: win.x, y: win.y };
    track(
      e,
      "drag",
      (dx, dy) => clampRect({ x: start.x + dx, y: start.y + dy, ...size }, viewport, info.minSize),
      (r) => dispatch({ type: "move", area, x: r.x, y: r.y }),
    );
  };

  const onEdgePointerDown = (edge: Edge) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!focused) dispatch({ type: "focus", area });
    const start: Rect = { x: win.x, y: win.y, w: win.w, h: win.h };
    track(
      e,
      "resize",
      (dx, dy) => resizeRect(start, edge, dx, dy, viewport, info.minSize),
      (r) => dispatch({ type: "resize", area, rect: r }),
    );
  };

  const classes = [
    "wm-window",
    focused ? "is-focused" : "is-background",
    win.maximized && "is-maximized",
    win.minimized && "is-minimized",
    interacting && `is-${interacting === "drag" ? "dragging" : "resizing"}`,
    phase !== "idle" && `is-${phase}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={outerRef}
      className={classes}
      data-area={area}
      role="region"
      aria-labelledby={titleId}
      aria-hidden={win.minimized || undefined}
      tabIndex={-1}
      style={{ transform: `translate3d(${win.x}px, ${win.y}px, 0)`, width: win.w, height: win.h, zIndex }}
      onPointerDownCapture={() => !focused && dispatch({ type: "focus", area })}
      onFocusCapture={() => !focused && dispatch({ type: "focus", area })}
    >
      <div className="wm-window__frame" onAnimationEnd={(e) => e.target === e.currentTarget && finishPhase(phase)}>
        <header className="wm-window__titlebar" onPointerDown={onTitlePointerDown} onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && dispatch({ type: "toggleMaximize", area })}>
          <span className="wm-window__icon">
            <Icon name={info.icon} size={16} />
          </span>
          <h2 id={titleId} className="wm-window__title" title={info.question}>
            {info.title}
          </h2>
          <div className="wm-window__controls">
            <IconButton size="sm" icon="minimize" label={`Minimise ${info.title}`} tooltipPlacement="bottom" onClick={minimize} />
            <IconButton
              size="sm"
              icon={win.maximized ? "restore" : "maximize"}
              label={win.maximized ? `Restore ${info.title}` : `Maximise ${info.title}`}
              tooltipPlacement="bottom"
              onClick={() => dispatch({ type: "toggleMaximize", area })}
            />
            <IconButton size="sm" icon="close" label={`Close ${info.title}`} tooltipPlacement="bottom" onClick={() => dispatch({ type: "close", area })} />
          </div>
        </header>
        <div className="wm-window__body">
          <div ref={contentRef} className="wm-window__content">
            <WindowBody area={area} token={token} actions={actions} />
          </div>
        </div>
      </div>
      {EDGES.map((edge) => (
        <div key={edge} className={`wm-resize wm-resize--${edge}`} onPointerDown={onEdgePointerDown(edge)} aria-hidden="true" />
      ))}
    </div>
  );
});
