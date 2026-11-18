/**
 * Keyboard shortcuts (§14), as a pure mapping from a key event to a
 * window-manager action:
 *   ⌘1–⌘9      open (or bring to front) the area at that dock position
 *   ⌘W         close the focused window
 *   ⌘M         minimise the focused window
 *   ⌘` / ⌃Tab  switch to the next window (add ⇧ for the previous one)
 */
import { AREAS } from "../areas.ts";
import type { WMAction, WMState } from "./state.ts";

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function shortcutAction(e: KeyLike, state: Pick<WMState, "focused">): WMAction | null {
  if (e.altKey) return null;
  if (e.ctrlKey && !e.metaKey && e.key === "Tab") return { type: "cycle", direction: e.shiftKey ? -1 : 1 };
  if (!e.metaKey || e.ctrlKey) return null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.shiftKey) {
    const area = AREAS[Number(digit[1]) - 1];
    return area ? { type: "open", area } : null;
  }
  if (e.code === "Backquote") return { type: "cycle", direction: e.shiftKey ? -1 : 1 };
  if (e.code === "KeyW" && !e.shiftKey) return state.focused ? { type: "closeFocused" } : null;
  if (e.code === "KeyM" && !e.shiftKey) return state.focused ? { type: "minimize", area: state.focused } : null;
  return null;
}
