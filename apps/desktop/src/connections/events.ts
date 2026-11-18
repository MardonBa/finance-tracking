/** Cross-component requests for the connection flows (handled by ConnectionHealthHost). */

export const RECONNECT_EVENT = "ft:reconnect";

export const SHOW_CONNECTION_PROMPT_EVENT = "ft:show-connection-prompt";

/** Show the "banks need attention" prompt again (e.g. after it was dismissed). */
export function showConnectionPrompt(): void {
  window.dispatchEvent(new Event(SHOW_CONNECTION_PROMPT_EVENT));
}

/** Start Plaid update mode for one bank (the Overview's alert, an account sheet, the prompt). */
export function requestReconnect(itemId: string): void {
  window.dispatchEvent(new CustomEvent<string>(RECONNECT_EVENT, { detail: itemId }));
}
