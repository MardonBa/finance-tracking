/** Cross-component requests for the connection flows (handled by ConnectionHealthHost). */

export const RECONNECT_EVENT = "ft:reconnect";

/** Start Plaid update mode for one bank (the Overview's alert, an account sheet, the prompt). */
export function requestReconnect(itemId: string): void {
  window.dispatchEvent(new CustomEvent<string>(RECONNECT_EVENT, { detail: itemId }));
}
