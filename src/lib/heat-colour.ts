/**
 * Heatmap fill for a % change: green up, red down, neutral at zero. Strength
 * grows with the move and is full at `fullAt` percent.
 */
export function heatFill(changePct: number | null, fullAt: number): string {
  if (changePct == null || changePct === 0) return "var(--heat-neutral)";
  const strength = Math.min(1, Math.abs(changePct) / fullAt);
  const colour = changePct > 0 ? "var(--heat-pos)" : "var(--heat-neg)";
  return `color-mix(in srgb, ${colour} ${Math.round(30 + strength * 70)}%, var(--heat-neutral))`;
}

/** Whether a fill is dark enough to need white text. */
export function heatIsStrong(changePct: number | null, fullAt: number): boolean {
  return changePct != null && Math.abs(changePct) >= fullAt / 2;
}
