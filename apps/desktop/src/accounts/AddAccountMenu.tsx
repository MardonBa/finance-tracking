/** "Add account" (§3 "Adding banks later", "Manual accounts"): a bank through Plaid, or a manual account such as cash. */
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/components.tsx";
import { Icon } from "../ui/Icon.tsx";
import { openManualAccountDialog } from "./AccountSheets.tsx";
import "../connections/connections.css";

export function AddAccountMenu({ onAddBank, size = "sm" }: { onAddBank: () => void; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="ft-menu" ref={ref}>
      <Button size={size} icon="plus" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Add account
      </Button>
      {open && (
        <ul className="ft-menu__list" role="menu" aria-label="Add account">
          <li role="none">
            <button type="button" role="menuitem" className="ft-menu__item" onClick={pick(onAddBank)}>
              <Icon name="bank" size={16} />
              <span>
                Bank or card
                <small>Connect through Plaid, in your browser</small>
              </span>
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className="ft-menu__item" onClick={pick(openManualAccountDialog)}>
              <Icon name="cash" size={16} />
              <span>
                Manual account
                <small>Cash or anything you track by hand</small>
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
