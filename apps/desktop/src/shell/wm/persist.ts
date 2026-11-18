/**
 * Layout persistence (§14): open/minimised windows, positions, sizes,
 * stacking order and focus survive restarts. Stored in localStorage as
 * versioned JSON; anything unreadable falls back to the first-run layout.
 * The desktop size isn't stored: the loaded layout is re-clamped to the
 * current one.
 */
import { isAreaId, type AreaId, type Size } from "../areas.ts";
import { initialState, invariantProblems, wmReducer, type Rect, type WindowState, type WMState } from "./state.ts";

export const LAYOUT_KEY = "ft.shell.layout";
export const LAYOUT_VERSION = 1;

export interface SavedLayout {
  version: typeof LAYOUT_VERSION;
  windows: WindowState[];
  /** Back to front. */
  order: AreaId[];
  focused: AreaId | null;
}

export function serialize(state: WMState): string {
  const layout: SavedLayout = {
    version: LAYOUT_VERSION,
    windows: state.order.map((a) => state.windows[a]).filter((w): w is WindowState => !!w),
    order: state.order,
    focused: state.focused,
  };
  return JSON.stringify(layout);
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readRect(v: unknown): Rect | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return num(r.x) && num(r.y) && num(r.w) && num(r.h) && r.w > 0 && r.h > 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}

/**
 * Parses a saved layout and fits it to `viewport`. Returns the first-run
 * layout when there's nothing usable. Never throws.
 */
export function deserialize(json: string | null, viewport: Size): WMState {
  const fallback = () => initialState(viewport);
  if (!json) return fallback();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fallback();
  }
  if (!raw || typeof raw !== "object" || (raw as SavedLayout).version !== LAYOUT_VERSION) return fallback();
  const saved = raw as Partial<SavedLayout>;
  if (!Array.isArray(saved.windows) || !Array.isArray(saved.order)) return fallback();

  const windows: WMState["windows"] = {};
  for (const w of saved.windows as unknown[]) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const rect = readRect(o);
    if (!isAreaId(o.area) || !rect || windows[o.area]) continue;
    windows[o.area] = {
      area: o.area,
      ...rect,
      minimized: o.minimized === true,
      maximized: o.maximized === true,
      restore: readRect(o.restore),
    };
  }
  const order: AreaId[] = [];
  for (const a of saved.order as unknown[]) if (isAreaId(a) && windows[a] && !order.includes(a)) order.push(a);
  for (const a of Object.keys(windows) as AreaId[]) if (!order.includes(a)) order.push(a);

  // Restore at the saved coordinates, then let setViewport clamp everything.
  let state: WMState = { windows, order, focused: null, viewport: { w: Number.MAX_SAFE_INTEGER, h: Number.MAX_SAFE_INTEGER } };
  state = wmReducer(state, { type: "setViewport", viewport });
  const focused = isAreaId(saved.focused) && windows[saved.focused] && !windows[saved.focused]?.minimized ? saved.focused : null;
  if (focused) state = wmReducer(state, { type: "focus", area: focused });
  else {
    const top = [...state.order].reverse().find((a) => !state.windows[a]?.minimized);
    if (top) state = wmReducer(state, { type: "focus", area: top });
  }
  return invariantProblems(state).length === 0 ? state : fallback();
}

export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadLayout(storage: LayoutStorage | undefined, viewport: Size): WMState {
  try {
    return deserialize(storage?.getItem(LAYOUT_KEY) ?? null, viewport);
  } catch {
    return initialState(viewport);
  }
}

export function saveLayout(storage: LayoutStorage | undefined, state: WMState): void {
  try {
    storage?.setItem(LAYOUT_KEY, serialize(state));
  } catch {
    // Storage full or unavailable: the layout just won't persist.
  }
}
