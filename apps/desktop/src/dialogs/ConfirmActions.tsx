/**
 * The shared before → after confirmation (ui/ActionConfirm.tsx) shown over
 * the whole screen, for edits made from sheets that sit above the desktop.
 */
import { ActionConfirm, type ActionConfirmProps } from "../ui/ActionConfirm.tsx";
import "./dialogs.css";

export function ConfirmActions(props: ActionConfirmProps) {
  return (
    <div className="ft-confirm-host">
      <ActionConfirm {...props} />
    </div>
  );
}
