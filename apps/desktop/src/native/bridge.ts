/**
 * Typed bridge to the Rust side (src-tauri/src/lib.rs). The app credential
 * lives in the Keychain and is only handed out after Touch ID.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** True inside the Tauri app (false in a plain browser tab, e.g. `vite` alone). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface LockStatus {
  unlocked: boolean;
  remainingSecs: number;
  relockAfterSecs: number;
}

export const native = {
  /** Touch ID (macOS password fallback). Resolves on success; unlocks the session for 72h. */
  authenticate: (reason: string) => invoke<void>("authenticate", { reason }),
  /** Touch ID, then the credential from the Keychain (null: none stored). */
  unlock: (reason: string) => invoke<string | null>("unlock", { reason }),
  /** The credential while unlocked; rejects with "locked" otherwise. */
  getCredential: () => invoke<string | null>("get_credential"),
  /** Whether a credential exists (doesn't read it). */
  hasCredential: () => invoke<boolean>("has_credential"),
  lockStatus: () => invoke<LockStatus>("lock_status"),
  lock: () => invoke<void>("lock"),
  /** Google sign-in in the system browser; the credential goes straight to the Keychain. */
  signInWithGoogle: (apiUrl: string) => invoke<void>("sign_in_with_google", { apiUrl }),
  /** Delete the credential and lock. */
  signOut: () => invoke<void>("sign_out"),
  /** financetracker:// links that arrived before anyone listened. */
  takeDeepLinks: () => invoke<string[]>("take_deep_links"),
  /** The 72h relock fired. */
  onLocked: (cb: () => void): Promise<UnlistenFn> => listen("app-locked", () => cb()),
  /** financetracker:// links opened while running. */
  onDeepLink: (cb: (urls: string[]) => void): Promise<UnlistenFn> => listen<string[]>("deep-link", (e) => cb(e.payload)),
};

/** Error text from a rejected invoke (Rust returns plain strings). */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
