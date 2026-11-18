/** Renders a window component inside the contexts the shell provides. */
import type { ReactElement } from "react";
import { configure, render } from "@testing-library/react";
import type { AreaId } from "../../shell/areas.ts";
import { AppTokenContext, WindowContext } from "../../shell/context.ts";

// The full suite runs many workers at once; give async UI a little longer than the 1s default.
configure({ asyncUtilTimeout: 5000 });

export function renderInWindow(ui: ReactElement, area: AreaId = "transactions") {
  const win = { area, token: "test-token", open() {}, close() {}, minimize() {}, addBanks() {} };
  return render(
    <AppTokenContext.Provider value="test-token">
      <WindowContext.Provider value={win}>{ui}</WindowContext.Provider>
    </AppTokenContext.Provider>,
  );
}
