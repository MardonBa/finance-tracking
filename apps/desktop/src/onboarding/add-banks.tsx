/**
 * First-run step 3 (§3): add banks, one Plaid Hosted Link session per bank,
 * as many as wanted; finishing with none is fine. The same component is the
 * "Add account" dialog later (useWindow().addBanks() opens the step with id
 * "add-banks").
 */
import { useMemo } from "react";
import { defineOnboardingStep, type OnboardingStepProps } from "../auth/onboarding.ts";
import { AppTokenContext } from "../shell/context.ts";
import { ConnectFlowView } from "../connections/ConnectFlow.tsx";
import { defaultConnectDeps, useConnectFlow } from "../connections/useConnectFlow.ts";
import { notifyConnectionsChanged } from "../connections/useConnections.ts";
import { notifyDataChanged } from "../data/hooks.ts";

export function AddBanks({ token, done }: OnboardingStepProps) {
  const deps = useMemo(() => defaultConnectDeps(token), [token]);
  const flow = useConnectFlow(deps);
  // A first run has no desktop yet; afterwards the dialog sits over the desktop.
  const firstRun = !document.querySelector(".wm-shell");
  const finish = () => {
    notifyConnectionsChanged();
    notifyDataChanged();
    done();
  };
  return (
    <AppTokenContext.Provider value={token}>
      <ConnectFlowView token={token} flow={flow} onFinish={finish} firstRun={firstRun} />
    </AppTokenContext.Provider>
  );
}

export default defineOnboardingStep({ id: "add-banks", order: 10, component: AddBanks });
