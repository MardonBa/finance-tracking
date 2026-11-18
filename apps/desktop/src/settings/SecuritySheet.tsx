/**
 * Settings / Security (§2 "I can revoke the app's credential"): the app
 * credentials the backend has issued (GET /auth/credentials), with "Sign out
 * this Mac" (revoke this credential) and "Revoke all" (e.g. a lost laptop).
 * Both are confirmed first; either sends the app back to Google sign-in.
 * Opened from the dock's Security button (openSecuritySheet()).
 */
import { useEffect, useState } from "react";
import { revokeCredential } from "../api/client.ts";
import { connectionsApi, errorMessage, type Credential } from "../connections/api.ts";
import { ConfirmDialog, Dialog } from "../dialogs/Dialog.tsx";
import { isTauri, native } from "../native/bridge.ts";
import { Button } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { relativeTime } from "../connections/useConnections.ts";

export const OPEN_SECURITY_EVENT = "ft:open-security";

export function openSecuritySheet(): void {
  window.dispatchEvent(new Event(OPEN_SECURITY_EVENT));
}

export interface SecuritySheetProps {
  token: string;
  /** The credential is gone: back to Google sign-in. */
  onSignedOut: () => void;
}

export function SecuritySheetHost(props: SecuritySheetProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_SECURITY_EVENT, on);
    return () => window.removeEventListener(OPEN_SECURITY_EVENT, on);
  }, []);
  return open ? <SecuritySheet {...props} onClose={() => setOpen(false)} /> : null;
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never");

export function SecuritySheet({ token, onSignedOut, onClose }: SecuritySheetProps & { onClose: () => void }) {
  const [creds, setCreds] = useState<Credential[]>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<"this" | "all" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    connectionsApi.credentials(token).then(
      (r) => live && setCreds(r.credentials),
      (e) => live && setError(errorMessage(e, "Couldn't load the credentials.")),
    );
    return () => {
      live = false;
    };
  }, [token]);

  const revoke = async (all: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await revokeCredential(token, { all });
      if (isTauri()) await native.signOut().catch(() => undefined);
      setConfirm(null);
      onClose();
      onSignedOut();
    } catch (e) {
      setError(errorMessage(e, "Couldn't revoke. Try again."));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        title="Security"
        eyebrow="Settings"
        onClose={onClose}
        footer={
          <>
            <Button icon="lock" onClick={() => setConfirm("this")}>
              Sign out this Mac
            </Button>
            <Button variant="danger" icon="shield" onClick={() => setConfirm("all")}>
              Revoke all
            </Button>
          </>
        }
      >
        <div className="ft-stack">
          <p className="ft-flow-text">
            These are the app credentials that can read your data. Revoking one stops it working immediately; this Mac then needs Google sign-in again.
          </p>
          {error && (
            <p className="ft-note ft-note--danger" role="alert">
              {error}
            </p>
          )}
          {!creds && !error && <p className="ft-muted">Loading…</p>}
          {creds && creds.length === 0 && <p className="ft-muted">No credentials are active (a development token is in use).</p>}
          {creds && creds.length > 0 && (
            <ul className="ft-list" aria-label="Active credentials">
              {creds.map((c) => (
                <li key={c.id} className="ft-row ft-row--between">
                  <span>
                    <Icon name="shield" size={14} /> <strong>{c.label ?? "App credential"}</strong>
                    {c.current && <span className="ft-badge ft-badge--ok"> This Mac</span>}
                    <br />
                    <span className="ft-small ft-muted">
                      Issued {date(c.createdAt)} · last used {relativeTime(c.lastUsedAt)} · expires {date(c.expiresAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
      {confirm && (
        <ConfirmDialog
          title={confirm === "all" ? "Revoke every credential?" : "Sign out this Mac?"}
          message={
            confirm === "all" ? (
              <p>Every device signed in to Finance Tracker, including this Mac, stops working right away and must sign in with Google again. This can't be undone.</p>
            ) : (
              <p>This Mac's credential is revoked and deleted from the Keychain. You'll need to sign in with Google again to open the app.</p>
            )
          }
          confirmLabel={confirm === "all" ? "Revoke all" : "Sign out"}
          danger
          busy={busy}
          onConfirm={() => void revoke(confirm === "all")}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
