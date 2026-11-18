/**
 * Small trend line (§7 merchant trend, §8 top merchants). Each month is a
 * transparent button over the line, so every point drills down (§15) and is
 * reachable by keyboard.
 */
export interface SparkPoint {
  key: string;
  /** Accessible label, e.g. "Oct 2026: $97.00". */
  label: string;
  value: number;
  onClick?: () => void;
}

export function Sparkline({ points, ariaLabel, height = 32, max }: { points: SparkPoint[]; ariaLabel: string; height?: number; max?: number }) {
  const n = points.length;
  const top = Math.max(max ?? 0, ...points.map((p) => p.value), 1);
  const bottom = Math.min(0, ...points.map((p) => p.value));
  const w = 100;
  const x = (i: number) => (n <= 1 ? w / 2 : (i + 0.5) * (w / n));
  const y = (v: number) => 2 + (1 - (v - bottom) / (top - bottom || 1)) * (height - 4);
  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  return (
    <div className="spark" style={{ height }} role="group" aria-label={ariaLabel}>
      <svg className="spark__svg" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={line} fill="none" stroke="var(--accent-blue)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {points.length > 0 && (
          <circle cx={x(n - 1)} cy={y(points[n - 1]!.value)} r="2.5" fill="var(--orange-600)" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="spark__hits">
        {points.map((p) =>
          p.onClick ? (
            <button key={p.key} type="button" className="spark__hit" aria-label={p.label} title={p.label} onClick={p.onClick} />
          ) : (
            <span key={p.key} className="spark__hit" title={p.label} />
          ),
        )}
      </div>
    </div>
  );
}
