/** The dock (§14): every area; click opens it, brings it to the front, or brings it back from minimised. */
import { memo, type Dispatch } from "react";
import { DockItem } from "../ui/components.tsx";
import { AREA_INFO, AREAS, shortcutFor } from "./areas.ts";
import type { WMAction, WMState } from "./wm/state.ts";
import { openSecuritySheet } from "../settings/SecuritySheet.tsx";

export const Dock = memo(function Dock({ state, dispatch }: { state: WMState; dispatch: Dispatch<WMAction> }) {
  return (
    <nav className="wm-dock" aria-label="Dock">
      <div className="wm-dock__shelf">
        {AREAS.map((area) => {
          const win = state.windows[area];
          return (
            <DockItem
              key={area}
              icon={AREA_INFO[area].icon}
              label={AREA_INFO[area].title}
              shortcut={shortcutFor(area)}
              state={!win ? "closed" : win.minimized ? "minimized" : "open"}
              focused={state.focused === area}
              onClick={() => dispatch({ type: "open", area })}
            />
          );
        })}
        <span className="wm-dock__divider" aria-hidden="true" />
        <DockItem icon="shield" label="Security" state="closed" onClick={openSecuritySheet} />
      </div>
    </nav>
  );
});
