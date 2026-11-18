/** Progress ring: saved / target and percent, in the goal's colour. */
import { usd } from "../budgets/format.ts";

export function ProgressRing({ savedCents, targetCents, color, size = 104 }: { savedCents: number; targetCents: number; color: string; size?: number }) {
  const pct = targetCents > 0 ? Math.min(100, (savedCents / targetCents) * 100) : 0;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const label = `${usd(savedCents)} of ${usd(targetCents)} saved, ${Math.floor(pct)} percent`;
  return (
    <div className="gl-ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-cream-deep)" strokeWidth={stroke} />
        <circle
          className="gl-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="gl-ring__pct">{Math.floor(pct)}%</span>
    </div>
  );
}
