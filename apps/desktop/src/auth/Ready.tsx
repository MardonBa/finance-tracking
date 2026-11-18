/**
 * What the app gate shows once unlocked: the desktop plus the sheets that sit
 * over it. Mounted fresh on every unlock (Touch ID at launch and after the
 * 72h relock), so the connection health check runs right after Touch ID (§4).
 */
import { useState } from "react";
import { Shell } from "../shell/Shell.tsx";
import { AppTokenContext } from "../shell/context.ts";
import { Card, EmptyState } from "../ui/components.tsx";
import { ConnectionHealthHost } from "../connections/ConnectionHealthHost.tsx";
import { AccountSheets } from "../accounts/AccountSheets.tsx";
import { SecuritySheetHost } from "../settings/SecuritySheet.tsx";
import { ADD_BANKS_STEP_ID, ONBOARDING_STEPS } from "./onboarding.ts";

export interface ReadyProps {
  token: string;
  /** The credential was revoked from the Security sheet: back to Google sign-in. */
  onSignedOut: () => void;
}

export function Ready({ token, onSignedOut }: ReadyProps) {
  const [addingBanks, setAddingBanks] = useState(false);
  const addBanks = ONBOARDING_STEPS.find((s) => s.id === ADD_BANKS_STEP_ID);
  return (
    <>
      <Shell token={token} onAddBanks={() => setAddingBanks(true)} />
      <AppTokenContext.Provider value={token}>
        <ConnectionHealthHost token={token} />
        <AccountSheets token={token} />
        <SecuritySheetHost token={token} onSignedOut={onSignedOut} />
      </AppTokenContext.Provider>
      {addingBanks && (
        <div className="gate-overlay" role="dialog" aria-modal="true" aria-label="Add a bank">
          {addBanks ? (
            <section className="gate-card gate-card--wide">
              <addBanks.component token={token} done={() => setAddingBanks(false)} />
            </section>
          ) : (
            <Card>
              <EmptyState
                icon="plus"
                title="Bank connections aren't set up yet"
                description="Adding banks through Plaid arrives with the onboarding flow."
                action={{ label: "Close", onClick: () => setAddingBanks(false) }}
              />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
