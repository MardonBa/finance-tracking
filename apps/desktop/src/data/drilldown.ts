/**
 * Cross-window navigation contract (§7, §13, §15 "the same action works the same everywhere").
 *
 * Any window calls `openDrillDown(...)` when a number, bar, segment or cell is clicked,
 * and `openMerchant(...)` when a merchant is clicked. The Transactions window
 * (owned by the transactions-spending track) listens and shows exactly the
 * transactions behind that figure, with `label` as the filter header.
 *
 * `query`/`params`/`figureId` identify a figure returned by a registry query
 * (`QueryResponse.figures[figureId]`); the Transactions window re-runs
 * `transactions.drillDown` with them, so its total always equals the figure.
 */
import type { AreaId } from "../shell/areas.ts";

export const DRILLDOWN_EVENT = "ft:drilldown";
export const MERCHANT_EVENT = "ft:open-merchant";
export const OPEN_ITEM_EVENT = "ft:open-item";

export interface DrillDownRequest {
  query: string;
  params: unknown;
  figureId: string;
  /** e.g. "Dining · October · excluding transfers" */
  label: string;
}

export interface MerchantRequest {
  merchantKey: string;
  label?: string;
}

/** Open a specific item in another window, e.g. a goal or a budget part. */
export interface OpenItemRequest {
  area: AreaId;
  itemId?: string;
}

type Opener = (area: AreaId) => void;
let opener: Opener | null = null;
let lastDrillDown: DrillDownRequest | null = null;
let lastMerchant: MerchantRequest | null = null;
let lastItem: OpenItemRequest | null = null;

/** The shell registers how to open/focus a window. */
export function setWindowOpener(fn: Opener | null): void {
  opener = fn;
}

export function openDrillDown(req: DrillDownRequest): void {
  lastDrillDown = req;
  opener?.("transactions");
  window.dispatchEvent(new CustomEvent<DrillDownRequest>(DRILLDOWN_EVENT, { detail: req }));
}

export function openMerchant(req: MerchantRequest): void {
  lastMerchant = req;
  opener?.("transactions");
  window.dispatchEvent(new CustomEvent<MerchantRequest>(MERCHANT_EVENT, { detail: req }));
}

export function openItem(req: OpenItemRequest): void {
  lastItem = req;
  opener?.(req.area);
  window.dispatchEvent(new CustomEvent<OpenItemRequest>(OPEN_ITEM_EVENT, { detail: req }));
}

/** For a window that mounts after the event fired (e.g. Transactions opened by the click). */
export function takePendingDrillDown(): DrillDownRequest | null {
  const r = lastDrillDown;
  lastDrillDown = null;
  return r;
}

export function takePendingMerchant(): MerchantRequest | null {
  const r = lastMerchant;
  lastMerchant = null;
  return r;
}

/** The last `openItem` for `area`, if a window mounts after the event fired (cleared once taken). */
export function takePendingItem(area: AreaId): OpenItemRequest | null {
  if (!lastItem || lastItem.area !== area) return null;
  const r = lastItem;
  lastItem = null;
  return r;
}
