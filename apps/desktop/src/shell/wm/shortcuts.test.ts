import { describe, expect, it } from "vitest";
import { shortcutAction, type KeyLike } from "./shortcuts.ts";

const key = (p: Partial<KeyLike>): KeyLike => ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...p });

describe("keyboard shortcuts (§14)", () => {
  it("⌘1–⌘9 open the areas in dock order", () => {
    expect(shortcutAction(key({ metaKey: true, code: "Digit1", key: "1" }), { focused: null })).toEqual({ type: "open", area: "overview" });
    expect(shortcutAction(key({ metaKey: true, code: "Digit9", key: "9" }), { focused: null })).toEqual({ type: "open", area: "assistant" });
    expect(shortcutAction(key({ code: "Digit1", key: "1" }), { focused: null })).toBeNull();
  });

  it("⌘W closes the focused window, nothing when none", () => {
    expect(shortcutAction(key({ metaKey: true, code: "KeyW", key: "w" }), { focused: "goals" })).toEqual({ type: "closeFocused" });
    expect(shortcutAction(key({ metaKey: true, code: "KeyW", key: "w" }), { focused: null })).toBeNull();
  });

  it("⌘` and ⌃Tab cycle windows, ⇧ reverses", () => {
    expect(shortcutAction(key({ metaKey: true, code: "Backquote" }), { focused: null })).toEqual({ type: "cycle", direction: 1 });
    expect(shortcutAction(key({ metaKey: true, shiftKey: true, code: "Backquote" }), { focused: null })).toEqual({ type: "cycle", direction: -1 });
    expect(shortcutAction(key({ ctrlKey: true, key: "Tab", code: "Tab" }), { focused: null })).toEqual({ type: "cycle", direction: 1 });
    expect(shortcutAction(key({ ctrlKey: true, shiftKey: true, key: "Tab", code: "Tab" }), { focused: null })).toEqual({ type: "cycle", direction: -1 });
  });

  it("⌘M minimises the focused window", () => {
    expect(shortcutAction(key({ metaKey: true, code: "KeyM" }), { focused: "spending" })).toEqual({ type: "minimize", area: "spending" });
  });

  it("ignores plain typing and other modifier combos", () => {
    expect(shortcutAction(key({ key: "w", code: "KeyW" }), { focused: "goals" })).toBeNull();
    expect(shortcutAction(key({ metaKey: true, altKey: true, code: "Digit1" }), { focused: null })).toBeNull();
    expect(shortcutAction(key({ metaKey: true, code: "KeyC" }), { focused: "goals" })).toBeNull();
  });
});
