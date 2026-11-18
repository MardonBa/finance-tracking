/**
 * A modal sheet over the desktop: scrim, raised white card, title, Escape
 * and the close button dismiss it (unless `dismissable` is false), and
 * focus moves into it when it opens.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, IconButton } from "../ui/components.tsx";
import "./dialogs.css";

export interface DialogProps {
  title: string;
  /** Small line above the title, e.g. "Step 3". */
  eyebrow?: string;
  onClose?: () => void;
  dismissable?: boolean;
  width?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ title, eyebrow, onClose, dismissable = true, width = "md", children, footer }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus], button:not([disabled]), input, select, textarea");
    first?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!dismissable || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissable, onClose]);

  return (
    <div className="ft-dialog-scrim">
      <div ref={ref} className={`ft-dialog ft-dialog--${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="ft-dialog__header">
          <div>
            {eyebrow && <p className="ft-dialog__eyebrow">{eyebrow}</p>}
            <h2 id={titleId} className="ft-dialog__title">
              {title}
            </h2>
          </div>
          {dismissable && onClose && <IconButton icon="close" label="Close" size="sm" onClick={onClose} noTooltip />}
        </header>
        <div className="ft-dialog__body">{children}</div>
        {footer && <footer className="ft-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}

/** A two-step confirmation inside a dialog: says what will happen and whether it can be undone. */
export interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      width="sm"
      footer={
        <>
          <Button onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ft-dialog__text">{message}</div>
    </Dialog>
  );
}
