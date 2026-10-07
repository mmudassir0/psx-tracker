/** A tiny trend line for a table cell. Coloured by the move over the window. */
export function Sparkline({
  values,
  width = 72,
  height = 22,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="text-slate-400">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const first = values[0];
  const last = values[values.length - 1];
  const colour =
    last > first ? "var(--diverge-pos-mid)" : last < first ? "var(--diverge-neg-mid)" : "var(--chart-muted)";
  const change = first > 0 ? ((last / first - 1) * 100).toFixed(1) : null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={change == null ? "Recent trend" : `${Number(change) > 0 ? "+" : ""}${change}% over the last ${values.length} sessions`}
      className="inline-block align-middle"
    >
      <polyline points={points} fill="none" stroke={colour} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
