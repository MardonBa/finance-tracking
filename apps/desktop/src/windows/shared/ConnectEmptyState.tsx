/**
 * An empty state whose next step is connecting a bank (§15 "every empty state
 * says what goes there and offers the next step"). The "Add a bank" button
 * opens the same flow as the Overview's "Add account" (§3).
 */
import { useContext } from "react";
import { WindowContext } from "../../shell/context.ts";
import { EmptyState, type EmptyStateProps } from "../../ui/components.tsx";

export function ConnectEmptyState(props: Omit<EmptyStateProps, "action">) {
  const win = useContext(WindowContext);
  return <EmptyState {...props} action={win ? { label: "Add a bank", icon: "bank", onClick: win.addBanks } : undefined} />;
}
