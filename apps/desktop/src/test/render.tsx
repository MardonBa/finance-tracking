/** Renders window contents inside the contexts the shell provides (test only). */
import type { ReactElement, ReactNode } from "react";
import { configure, render } from "@testing-library/react";
import type { AreaId } from "../shell/areas.ts";
import { AppTokenContext, WindowContext } from "../shell/context.ts";

// The full suite runs many workers at once; give async UI a little longer than the 1s default.
configure({ asyncUtilTimeout: 5000 });

/** Inside a window: the app token plus `useWindow()` (area, open/close/minimise no-ops). */
export function renderInWindow(ui: ReactElement, area: AreaId = "transactions") {
  const win = { area, token: "test-token", open() {}, close() {}, minimize() {}, addBanks() {} };
  return render(
    <AppTokenContext.Provider value="test-token">
      <WindowContext.Provider value={win}>{ui}</WindowContext.Provider>
    </AppTokenContext.Provider>,
  );
}

export function WithToken({ children }: { children: ReactNode }) {
  return <AppTokenContext.Provider value="test-token">{children}</AppTokenContext.Provider>;
}

/** Just the app token (components that don't call `useWindow()`). */
export function renderWithToken(ui: ReactNode) {
  return render(<WithToken>{ui}</WithToken>);
}
