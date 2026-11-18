/**
 * Discovers Phase 2 windows: every `src/windows/<name>/window.tsx` whose
 * default export is `defineWindow({...})`. Areas without one show their
 * placeholder (placeholders.tsx).
 */
import type { ComponentType } from "react";
import type { AreaId } from "./areas.ts";
import { PLACEHOLDERS } from "./placeholders.tsx";
import { registeredWindow, registerModules } from "./registry.ts";

registerModules(import.meta.glob("../windows/*/window.tsx", { eager: true }));

export function windowComponent(area: AreaId): ComponentType {
  return registeredWindow(area)?.component ?? PLACEHOLDERS[area];
}
