/**
 * Transactions (§7): "What exactly did I spend and earn?"
 *
 * Owns the drill-down receiver: on mount and on every `ft:drilldown` /
 * `ft:open-merchant` it switches to that view, with the filter shown at the
 * top. Otherwise it shows all transactions (search + filters), "Needs a look",
 * the balance check (§6 "unexplained") or the Poker summary. `openItem({ area:
 * "transactions", itemId })` with "needs-a-look" / "reconciliation" / "poker"
 * (e.g. from the Overview's alerts strip) switches to that view.
 */
import { useEffect, useState } from "react";
import {
  DRILLDOWN_EVENT,
  MERCHANT_EVENT,
  OPEN_ITEM_EVENT,
  takePendingDrillDown,
  takePendingItem,
  takePendingMerchant,
  type DrillDownRequest,
  type MerchantRequest,
  type OpenItemRequest,
} from "../../data/drilldown.ts";
import { useQuery } from "../../data/hooks.ts";
import { useCategoryColors } from "../../data/useCategoryColors.ts";
import { useWindow } from "../../shell/context.ts";
import { IconButton, Tabs } from "../../ui/components.tsx";
import { DrillDownView } from "./DrillDownView.tsx";
import { MerchantView } from "./MerchantView.tsx";
import { BalanceCheckView } from "./BalanceCheckView.tsx";
import { NeedsALookView, type NeedsALookValue } from "./NeedsALookView.tsx";
import { PokerView } from "./PokerView.tsx";
import { SearchView } from "./SearchView.tsx";
import "./transactions.css";

type TabView = "all" | "needs" | "check" | "poker";
export type TxView = { kind: TabView } | { kind: "drill"; req: DrillDownRequest } | { kind: "merchant"; req: MerchantRequest };

/** Item ids other windows can open with `openItem({ area: "transactions", itemId })`. */
export const TRANSACTIONS_ITEMS: Record<string, TabView> = {
  "needs-a-look": "needs",
  reconciliation: "check",
  poker: "poker",
};

function tabForItem(req: OpenItemRequest | null): TabView | null {
  return req?.area === "transactions" && req.itemId ? (TRANSACTIONS_ITEMS[req.itemId] ?? null) : null;
}

function initialView(): TxView {
  const d = takePendingDrillDown();
  if (d) return { kind: "drill", req: d };
  const m = takePendingMerchant();
  if (m) return { kind: "merchant", req: m };
  const t = tabForItem(takePendingItem("transactions"));
  if (t) return { kind: t };
  return { kind: "all" };
}

const isTab = (k: TxView["kind"]): k is TabView => k === "all" || k === "needs" || k === "check" || k === "poker";

export function TransactionsWindow() {
  const win = useWindow();
  const [view, setView] = useState<TxView>(initialView);
  // Remember the tab to go back to when a filter is cleared.
  const [tab, setTab] = useState<TabView>(() => (isTab(view.kind) ? view.kind : "all"));
  useCategoryColors();
  const needs = useQuery<NeedsALookValue>("flows.needsALook", {});

  useEffect(() => {
    const onDrill = (e: Event) => {
      takePendingDrillDown();
      setView({ kind: "drill", req: (e as CustomEvent<DrillDownRequest>).detail });
    };
    const onMerchant = (e: Event) => {
      takePendingMerchant();
      setView({ kind: "merchant", req: (e as CustomEvent<MerchantRequest>).detail });
    };
    const onItem = (e: Event) => {
      const t = tabForItem((e as CustomEvent<OpenItemRequest>).detail);
      if (!t) return;
      takePendingItem("transactions");
      setTab(t);
      setView({ kind: t });
    };
    window.addEventListener(DRILLDOWN_EVENT, onDrill);
    window.addEventListener(MERCHANT_EVENT, onMerchant);
    window.addEventListener(OPEN_ITEM_EVENT, onItem);
    return () => {
      window.removeEventListener(DRILLDOWN_EVENT, onDrill);
      window.removeEventListener(MERCHANT_EVENT, onMerchant);
      window.removeEventListener(OPEN_ITEM_EVENT, onItem);
    };
  }, []);

  const needsCount = needs.data?.value.count ?? 0;
  const filterLabel = view.kind === "drill" ? view.req.label : view.kind === "merchant" ? (view.req.label ?? "Merchant") : null;

  return (
    <div className="tx-window">
      {filterLabel !== null ? (
        <header className="tx-filter-header" data-testid="filter-header">
          <div className="tx-filter-header__text">
            <span className="tx-filter-header__kind">{view.kind === "drill" ? "Showing what's behind" : "Merchant"}</span>
            <h2 className="tx-filter-header__label">{filterLabel}</h2>
          </div>
          <IconButton icon="close" label="Clear filter and show all transactions" onClick={() => setView({ kind: tab })} />
        </header>
      ) : (
        <Tabs
          label="Transactions views"
          value={isTab(view.kind) ? view.kind : tab}
          onChange={(v) => {
            setTab(v);
            setView({ kind: v });
          }}
          tabs={[
            { value: "all", label: "All transactions" },
            { value: "needs", label: needsCount > 0 ? `Needs a look (${needsCount})` : "Needs a look" },
            { value: "check", label: "Balance check" },
            { value: "poker", label: "Poker" },
          ]}
        />
      )}
      <div className="tx-body" role="tabpanel" aria-labelledby={filterLabel === null ? `tab-${view.kind}` : undefined}>
        {view.kind === "all" && <SearchView onAddBank={win.addBanks} />}
        {view.kind === "needs" && <NeedsALookView />}
        {view.kind === "check" && <BalanceCheckView />}
        {view.kind === "poker" && <PokerView />}
        {view.kind === "drill" && <DrillDownView key={JSON.stringify(view.req)} req={view.req} />}
        {view.kind === "merchant" && <MerchantView key={view.req.merchantKey} req={view.req} />}
      </div>
    </div>
  );
}
