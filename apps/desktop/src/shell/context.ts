/**
 * Contexts the shell provides to window contents. Values are stable (they
 * don't change while a window moves or resizes), so window contents never
 * re-render because of a drag.
 */
import { createContext, useContext } from "react";
import type { AreaId } from "./areas.ts";

export interface ShellActions {
  /** Open an area (or bring it to the front). */
  open(area: AreaId): void;
  close(area: AreaId): void;
  minimize(area: AreaId): void;
  /** Phase 2 hook: start the "add a bank" flow (§3 step 3). */
  addBanks(): void;
}

export interface WindowContextValue extends ShellActions {
  area: AreaId;
  /** The app credential for API calls (from the Keychain after Touch ID). */
  token: string;
}

export const ShellActionsContext = createContext<ShellActions | null>(null);
export const WindowContext = createContext<WindowContextValue | null>(null);
export const AppTokenContext = createContext<string | null>(null);

/** Inside a window component: its area, the app token and window actions. */
export function useWindow(): WindowContextValue {
  const v = useContext(WindowContext);
  if (!v) throw new Error("useWindow() must be used inside a shell window");
  return v;
}

export function useShellActions(): ShellActions {
  const v = useContext(ShellActionsContext);
  if (!v) throw new Error("useShellActions() must be used inside the shell");
  return v;
}

export function useAppToken(): string {
  const v = useContext(AppTokenContext);
  if (v === null) throw new Error("useAppToken() must be used after sign-in");
  return v;
}
