/** Full-screen gate layout: the pixel-waves background with one raised card. */
import type { ReactNode } from "react";
import { PixelWaves } from "../shell/background/PixelWaves.tsx";
import { Icon } from "../ui/Icon.tsx";
import "./gate.css";

export interface LockScreenProps {
  title?: string;
  /** e.g. "Step 1 of 2". */
  step?: string;
  error?: string;
  notice?: string;
  wide?: boolean;
  children?: ReactNode;
}

export function LockScreen({ title, step, error, notice, wide, children }: LockScreenProps) {
  return (
    <div className="gate">
      <PixelWaves />
      <section className={`gate-card${wide ? " gate-card--wide" : ""}`} aria-live="polite">
        {title && (
          <header className="gate-card__header">
            <span className="gate-card__badge">
              <Icon name="lock" size={20} />
            </span>
            {step && <p className="gate-card__step">{step}</p>}
            <h1 className="gate-card__title">{title}</h1>
          </header>
        )}
        {notice && (
          <p className="gate-message gate-message--notice">
            <Icon name="info" size={16} />
            {notice}
          </p>
        )}
        {error && (
          <p className="gate-message gate-message--error" role="alert">
            <Icon name="warning" size={16} />
            {error}
          </p>
        )}
        {children}
      </section>
    </div>
  );
}
