/**
 * Window-manager state and reducer (§14). Pure: no DOM, no clock, so every
 * rule is unit-tested (state.test.ts).
 *
 * Invariants (kept by every action):
 * - One window per area: `windows` is keyed by area.
 * - `order` lists every open window (minimised included) back to front,
 *   exactly once.
 * - `focused` is null or a visible (not minimised) window, and it is the
 *   front-most visible window.
 * - Every window lies fully inside the desktop (`viewport`), so its title
 *   bar is always visible; sizes never go below the area's minimum unless
 *   the desktop itself is smaller.
 */
import { AREA_INFO, AREAS, type AreaId, type Size } from "../areas.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowState extends Rect {
  area: AreaId;
  minimized: boolean;
  maximized: boolean;
  /** Rect to go back to when un-maximising. */
  restore: Rect | null;
}

export interface WMState {
  windows: Partial<Record<AreaId, WindowState>>;
  /** Back to front. */
  order: AreaId[];
  focused: AreaId | null;
  viewport: Size;
}

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type WMAction =
  | { type: "open"; area: AreaId }
  | { type: "close"; area: AreaId }
  | { type: "focus"; area: AreaId }
  | { type: "minimize"; area: AreaId }
  | { type: "toggleMaximize"; area: AreaId }
  | { type: "move"; area: AreaId; x: number; y: number }
  | { type: "resize"; area: AreaId; rect: Rect }
  | { type: "setViewport"; viewport: Size }
  | { type: "cycle"; direction: 1 | -1 }
  | { type: "closeFocused" }
  | { type: "replace"; state: WMState };

/** Offset between cascaded new windows. */
export const CASCADE_STEP = 32;

const clampNum = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Keeps a rect fully inside the viewport, at least `min` big where the viewport allows. */
export function clampRect(r: Rect, viewport: Size, min: Size): Rect {
  const vw = Math.max(0, Math.floor(viewport.w));
  const vh = Math.max(0, Math.floor(viewport.h));
  const w = Math.round(clampNum(r.w, Math.min(min.w, vw), vw));
  const h = Math.round(clampNum(r.h, Math.min(min.h, vh), vh));
  const x = Math.round(clampNum(r.x, 0, vw - w));
  const y = Math.round(clampNum(r.y, 0, vh - h));
  return { x, y, w, h };
}

/**
 * The rect after dragging `edge` by (dx, dy) from `start`. The opposite edge
 * stays put; the size respects `min` and the moving edge stops at the
 * viewport.
 */
export function resizeRect(start: Rect, edge: Edge, dx: number, dy: number, viewport: Size, min: Size): Rect {
  const minW = Math.min(min.w, viewport.w);
  const minH = Math.min(min.h, viewport.h);
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  if (edge.includes("e")) w = clampNum(start.w + dx, minW, viewport.w - start.x);
  if (edge.includes("s")) h = clampNum(start.h + dy, minH, viewport.h - start.y);
  if (edge.includes("w")) {
    x = clampNum(start.x + dx, 0, right - minW);
    w = right - x;
  }
  if (edge.includes("n")) {
    y = clampNum(start.y + dy, 0, bottom - minH);
    h = bottom - y;
  }
  return clampRect({ x, y, w, h }, viewport, min);
}

const minSizeOf = (area: AreaId): Size => AREA_INFO[area].minSize;
const fullRect = (v: Size): Rect => ({ x: 0, y: 0, w: Math.floor(v.w), h: Math.floor(v.h) });

export function emptyState(viewport: Size): WMState {
  return { windows: {}, order: [], focused: null, viewport };
}

/** A new window at its default size: centred, cascaded by the number of visible windows. */
export function placeNewWindow(area: AreaId, state: WMState): Rect {
  const { w, h } = AREA_INFO[area].defaultSize;
  const visible = state.order.filter((a) => !state.windows[a]?.minimized).length;
  const cx = (state.viewport.w - w) / 2;
  const cy = (state.viewport.h - h) / 2;
  const step = visible * CASCADE_STEP;
  // Wrap the cascade before it runs off the desktop.
  const room = Math.max(1, Math.min(state.viewport.w - w - cx, state.viewport.h - h - cy));
  const off = room > CASCADE_STEP ? step % room : 0;
  return clampRect({ x: cx + off, y: cy + off, w, h }, state.viewport, minSizeOf(area));
}

/** First run (§14): only the Overview open, centred. */
export function initialState(viewport: Size): WMState {
  return wmReducer(emptyState(viewport), { type: "open", area: "overview" });
}

function topVisible(state: Pick<WMState, "order" | "windows">, except?: AreaId): AreaId | null {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const a = state.order[i] as AreaId;
    if (a !== except && !state.windows[a]?.minimized) return a;
  }
  return null;
}

function toFront(order: AreaId[], area: AreaId): AreaId[] {
  return [...order.filter((a) => a !== area), area];
}

function withWindow(state: WMState, area: AreaId, patch: Partial<WindowState>): WMState {
  const win = state.windows[area];
  if (!win) return state;
  return { ...state, windows: { ...state.windows, [area]: { ...win, ...patch } } };
}

function fit(win: WindowState, viewport: Size): WindowState {
  if (win.maximized) return { ...win, ...fullRect(viewport), restore: win.restore && clampRect(win.restore, viewport, minSizeOf(win.area)) };
  return { ...win, ...clampRect(win, viewport, minSizeOf(win.area)) };
}

export function wmReducer(state: WMState, action: WMAction): WMState {
  switch (action.type) {
    case "open": {
      const existing = state.windows[action.area];
      if (existing) {
        return { ...withWindow(state, action.area, { minimized: false }), order: toFront(state.order, action.area), focused: action.area };
      }
      const rect = placeNewWindow(action.area, state);
      const win: WindowState = { area: action.area, ...rect, minimized: false, maximized: false, restore: null };
      return {
        ...state,
        windows: { ...state.windows, [action.area]: win },
        order: toFront(state.order, action.area),
        focused: action.area,
      };
    }
    case "focus": {
      if (!state.windows[action.area]) return state;
      if (state.focused === action.area && state.order[state.order.length - 1] === action.area) return state;
      return { ...withWindow(state, action.area, { minimized: false }), order: toFront(state.order, action.area), focused: action.area };
    }
    case "close": {
      if (!state.windows[action.area]) return state;
      const windows = { ...state.windows };
      delete windows[action.area];
      const order = state.order.filter((a) => a !== action.area);
      const focused = state.focused === action.area ? topVisible({ order, windows }) : state.focused;
      return { ...state, windows, order, focused };
    }
    case "closeFocused":
      return state.focused ? wmReducer(state, { type: "close", area: state.focused }) : state;
    case "minimize": {
      if (!state.windows[action.area]) return state;
      const next = withWindow(state, action.area, { minimized: true });
      return { ...next, focused: state.focused === action.area ? topVisible(next, action.area) : state.focused };
    }
    case "toggleMaximize": {
      const win = state.windows[action.area];
      if (!win) return state;
      const patch: Partial<WindowState> = win.maximized
        ? { maximized: false, restore: null, ...clampRect(win.restore ?? win, state.viewport, minSizeOf(win.area)) }
        : { maximized: true, restore: { x: win.x, y: win.y, w: win.w, h: win.h }, ...fullRect(state.viewport) };
      return { ...withWindow(state, action.area, { ...patch, minimized: false }), order: toFront(state.order, action.area), focused: action.area };
    }
    case "move": {
      const win = state.windows[action.area];
      if (!win) return state;
      // Dragging a maximised window un-maximises it at its restore size.
      const size = win.maximized && win.restore ? { w: win.restore.w, h: win.restore.h } : { w: win.w, h: win.h };
      const rect = clampRect({ x: action.x, y: action.y, ...size }, state.viewport, minSizeOf(win.area));
      return withWindow(state, action.area, { ...rect, maximized: false, restore: null });
    }
    case "resize": {
      const win = state.windows[action.area];
      if (!win) return state;
      return withWindow(state, action.area, { ...clampRect(action.rect, state.viewport, minSizeOf(win.area)), maximized: false, restore: null });
    }
    case "setViewport": {
      const viewport = { w: Math.max(0, Math.floor(action.viewport.w)), h: Math.max(0, Math.floor(action.viewport.h)) };
      if (viewport.w === state.viewport.w && viewport.h === state.viewport.h) return state;
      const windows: WMState["windows"] = {};
      for (const a of state.order) {
        const win = state.windows[a];
        if (win) windows[a] = fit(win, viewport);
      }
      return { ...state, windows, viewport };
    }
    case "cycle": {
      const visible = state.order.filter((a) => !state.windows[a]?.minimized);
      if (visible.length < 2) return state;
      if (action.direction === 1) {
        // Bring the back-most visible window to the front (repeating visits all).
        const back = visible[0] as AreaId;
        return { ...state, order: toFront(state.order, back), focused: back };
      }
      // Send the front window to the back; the next one gets focus.
      const front = visible[visible.length - 1] as AreaId;
      const order = [front, ...state.order.filter((a) => a !== front)];
      return { ...state, order, focused: topVisible({ order, windows: state.windows }) };
    }
    case "replace":
      return action.state;
  }
}

/** Checks the invariants above; returns the problems (empty = valid). Used by tests and on load. */
export function invariantProblems(state: WMState): string[] {
  const problems: string[] = [];
  const keys = Object.keys(state.windows) as AreaId[];
  if (new Set(state.order).size !== state.order.length) problems.push("order has duplicates");
  for (const k of keys) if (!state.order.includes(k)) problems.push(`${k} missing from order`);
  for (const a of state.order) if (!state.windows[a]) problems.push(`${a} in order but not open`);
  for (const k of keys) {
    const w = state.windows[k] as WindowState;
    if (w.area !== k) problems.push(`${k} has area ${w.area}`);
    if (w.x < 0 || w.y < 0 || w.x + w.w > state.viewport.w || w.y + w.h > state.viewport.h) problems.push(`${k} outside the desktop`);
  }
  if (state.focused) {
    const f = state.windows[state.focused];
    if (!f) problems.push("focused window not open");
    else if (f.minimized) problems.push("focused window minimised");
    else if (topVisible(state) !== state.focused) problems.push("focused window not in front");
  } else if (topVisible(state) !== null) {
    problems.push("visible windows but nothing focused");
  }
  return problems;
}

export { AREAS };
