/**
 * The desktop (§14): pixel-waves background, the windows, the dock, layout
 * persistence and keyboard shortcuts. Rendered only after the app gate has
 * unlocked (no data loads before Touch ID).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { AREAS } from "./areas.ts";
import { PixelWaves } from "./background/PixelWaves.tsx";
import { AppTokenContext, ShellActionsContext, type ShellActions } from "./context.ts";
import { Dock } from "./Dock.tsx";
import { Window } from "./Window.tsx";
import { loadLayout, saveLayout } from "./wm/persist.ts";
import { shortcutAction } from "./wm/shortcuts.ts";
import { wmReducer, type WMAction, type WMState } from "./wm/state.ts";
import "./shell.css";
import { setWindowOpener } from "../data/drilldown.ts";

type ShellAction = WMAction;

function shellReducer(state: WMState | null, action: ShellAction): WMState | null {
  if (action.type === "replace") return action.state;
  return state ? wmReducer(state, action) : state;
}

const SAVE_DELAY_MS = 150;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export interface ShellProps {
  token: string;
  /** Phase 2 hook: start the add-a-bank flow. */
  onAddBanks: () => void;
}

export function Shell({ token, onAddBanks }: ShellProps) {
  const desktopRef = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(shellReducer, null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Load the saved layout once the desktop has a size; then follow resizes (re-clamp).
  useLayoutEffect(() => {
    const el = desktopRef.current;
    if (!el) return;
    let loaded = false;
    const measure = () => {
      const size = { w: el.clientWidth, h: el.clientHeight };
      // Wait for a real size: loading against a 0x0 desktop would shrink every window.
      if (size.w < 1 || size.h < 1) return;
      if (!loaded) {
        loaded = true;
        dispatch({ type: "replace", state: loadLayout(storage(), size) });
      } else {
        dispatch({ type: "setViewport", viewport: size });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Persist (debounced).
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => saveLayout(storage(), state), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Save immediately when the app is closing.
  useEffect(() => {
    const flush = () => stateRef.current && saveLayout(storage(), stateRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s) return;
      const action = shortcutAction(e, s);
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keyboard focus follows the focused window (e.g. after ⌘3 or ⌘`).
  const focused = state?.focused ?? null;
  useEffect(() => {
    if (!focused) return;
    const el = desktopRef.current?.querySelector<HTMLElement>(`.wm-window[data-area="${focused}"]`);
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [focused]);

  const addBanks = useRef(onAddBanks);
  addBanks.current = onAddBanks;
  const actions: ShellActions = useMemo(
    () => ({
      open: (area) => dispatch({ type: "open", area }),
      close: (area) => dispatch({ type: "close", area }),
      minimize: (area) => dispatch({ type: "minimize", area }),
      addBanks: () => addBanks.current(),
    }),
    [],
  );
  const stableDispatch = useCallback((a: WMAction) => dispatch(a), []);
  // Cross-window navigation (drill-downs, merchants, items) opens windows through the shell.
  useEffect(() => {
    setWindowOpener(actions.open);
    return () => setWindowOpener(null);
  }, [actions]);

  return (
    <AppTokenContext.Provider value={token}>
      <ShellActionsContext.Provider value={actions}>
        <div className="wm-shell">
          <PixelWaves />
          <main ref={desktopRef} className="wm-desktop" aria-label="Desktop">
            {/* Stable DOM order (dock order); stacking is z-index, so focusing never moves DOM nodes mid-drag. */}
            {state &&
              AREAS.map((area) => {
                const win = state.windows[area];
                return win ? (
                  <Window
                    key={area}
                    win={win}
                    focused={state.focused === area}
                    zIndex={state.order.indexOf(area) + 1}
                    viewport={state.viewport}
                    token={token}
                    actions={actions}
                    dispatch={stableDispatch}
                  />
                ) : null;
              })}
          </main>
          {state && <Dock state={state} dispatch={stableDispatch} />}
        </div>
      </ShellActionsContext.Provider>
    </AppTokenContext.Provider>
  );
}
