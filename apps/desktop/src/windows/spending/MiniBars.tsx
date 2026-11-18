/**
 * Tiny column chart made of buttons: each bar drills down (§15) and is
 * keyboard reachable. Bars share `max` so small multiples use one scale.
 */
export interface Bar {
  key: string;
  /** Short label under the bar ("Oct"). */
  short: string;
  /** Accessible / tooltip label ("Dining · Oct 2026: $412.00"). */
  label: string;
  value: number;
  onClick?: () => void;
  /** Emphasise (e.g. the selected month). */
  current?: boolean;
  /** Small text above the bar (e.g. a savings rate). */
  top?: string;
}

export function MiniBars({ bars, max, color, height = 56, ariaLabel, showShort = true }: { bars: Bar[]; max: number; color: string; height?: number; ariaLabel: string; showShort?: boolean }) {
  const top = Math.max(max, 1);
  return (
    <div className="minibars" role="group" aria-label={ariaLabel}>
      {bars.map((b) => {
        const h = Math.max(0, Math.min(1, b.value / top));
        const bar = (
          <span
            className={`minibars__bar${b.current ? " is-current" : ""}`}
            style={{ height: `${Math.max(h * 100, b.value > 0 ? 3 : 0)}%`, background: color }}
          />
        );
        return (
          <div key={b.key} className="minibars__col">
            {b.top !== undefined && <span className="minibars__top">{b.top}</span>}
            {b.onClick ? (
              <button type="button" className="minibars__hit" style={{ height }} aria-label={b.label} title={b.label} onClick={b.onClick}>
                {bar}
              </button>
            ) : (
              <span className="minibars__hit is-static" style={{ height }} title={b.label}>
                {bar}
              </span>
            )}
            {showShort && <span className={`minibars__short${b.current ? " is-current" : ""}`}>{b.short}</span>}
          </div>
        );
      })}
    </div>
  );
}
