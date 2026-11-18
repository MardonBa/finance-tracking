/**
 * Window registration API for Phase 2.
 *
 * Each feature track adds its window in ITS OWN file, no shared edits:
 *
 *   // src/windows/spending/window.tsx
 *   import { defineWindow } from "../../shell/registry";
 *   import { SpendingWindow } from "./SpendingWindow";
 *   export default defineWindow({ area: "spending", component: SpendingWindow });
 *
 * The shell discovers every `src/windows/<anything>/window.tsx` at build time
 * (shell/windows.ts, `import.meta.glob`) and uses its default export instead
 * of the area's placeholder. Inside the component, `useWindow()` gives the
 * area, the app token and window actions (close, minimise, open another area).
 *
 * Rules for window components (so drag/resize stay smooth):
 * - Fill the body: the shell gives a flex column of the window's size.
 * - Don't read window position or size; the shell freezes the body's size
 *   during a resize and releases it once at the end (charts resize once).
 * - One main question per window (§15); split into another area if it grows.
 */
import type { ComponentType } from "react";
import { AREA_INFO, isAreaId, type AreaId, type Size } from "./areas.ts";

export interface WindowDefinition {
  area: AreaId;
  /** The window's content. Rendered once and kept mounted while the window is open (even minimised). */
  component: ComponentType;
  /** Optional overrides of the area's default and minimum sizes (areas.ts). */
  defaultSize?: Size;
  minSize?: Size;
}

const registered = new Map<AreaId, WindowDefinition>();

/** Identity helper for typed default exports. */
export function defineWindow(def: WindowDefinition): WindowDefinition {
  return def;
}

/** Register (or replace) the window for an area. Later registrations win. */
export function registerWindow(def: WindowDefinition): void {
  if (!isAreaId(def.area)) throw new Error(`Unknown area: ${String(def.area)}`);
  registered.set(def.area, def);
  // Sizes are config read by the pure reducer; set before any window opens.
  if (def.defaultSize) AREA_INFO[def.area].defaultSize = { ...def.defaultSize };
  if (def.minSize) AREA_INFO[def.area].minSize = { ...def.minSize };
}

export function registeredWindow(area: AreaId): WindowDefinition | undefined {
  return registered.get(area);
}

/** Registers the default export of each discovered module; returns the areas registered. */
export function registerModules(modules: Record<string, unknown>): AreaId[] {
  const areas: AreaId[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const def = (mod as { default?: WindowDefinition }).default;
    if (!def || !isAreaId(def.area) || !def.component) {
      console.warn(`[shell] ${path} has no valid default export from defineWindow(...)`);
      continue;
    }
    registerWindow(def);
    areas.push(def.area);
  }
  return areas;
}
