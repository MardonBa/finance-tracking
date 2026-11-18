/**
 * Every edit in these windows goes through a registry action and shows its
 * before → after preview first, using the app's shared `ui/ActionConfirm`
 * card (the same one the AI's proposals use). This wrapper adds the inline
 * "Review" button and a hint while the form is incomplete.
 */
import { useState } from "react";
import { Button } from "../../ui/components.tsx";
import { ActionConfirm } from "../../ui/ActionConfirm.tsx";
import "./shared.css";

export interface ReviewAndConfirmProps {
  action: string;
  /** null while the form is incomplete (Review is disabled). */
  input: unknown | null;
  reviewLabel?: string;
  confirmLabel?: string;
  /** Title of the confirmation card. */
  title?: string;
  destructive?: boolean;
  onDone?: (logIds: string[]) => void;
  onCancel?: () => void;
  /** Why Review is disabled, shown as a hint. */
  invalidReason?: string;
}

export function ReviewAndConfirm({
  action,
  input,
  reviewLabel = "Review",
  confirmLabel = "Confirm",
  title = "Check the change",
  destructive,
  onDone,
  onCancel,
  invalidReason,
}: ReviewAndConfirmProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rti-review">
      {input === null && invalidReason && <p className="rti-hint">{invalidReason}</p>}
      <div className="rti-review__buttons">
        <Button variant="primary" onClick={() => setOpen(true)} disabled={input === null}>
          {reviewLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {open && input !== null && (
        <ActionConfirm
          title={title}
          steps={[{ name: action, input }]}
          confirmLabel={confirmLabel}
          destructive={destructive}
          onCancel={() => setOpen(false)}
          onDone={(ids) => {
            setOpen(false);
            onDone?.(ids);
          }}
        />
      )}
    </div>
  );
}
