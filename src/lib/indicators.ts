/**
 * Price indicators for the stock chart. Pure functions over closes in date
 * order; each returns one value per input point (null until enough history).
 */

/** Simple moving average of the last `n` closes. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

/**
 * Relative Strength Index with Wilder's smoothing (the standard RSI). Above
 * 70 is usually read as overbought, below 30 as oversold.
 */
export function rsi(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}

export interface TrendNote {
  text: string;
  tone: "up" | "down" | "neutral";
}

/** Plain-language readings of the latest values. */
export function trendNotes(
  close: number | null,
  sma50: number | null,
  sma200: number | null,
  rsi14: number | null,
): TrendNote[] {
  const notes: TrendNote[] = [];
  if (close != null && sma200 != null && sma200 > 0) {
    const gap = (close / sma200 - 1) * 100;
    notes.push({
      text: `Price is ${Math.abs(gap).toFixed(1)}% ${gap >= 0 ? "above" : "below"} its 200-day average`,
      tone: gap >= 0 ? "up" : "down",
    });
  }
  if (sma50 != null && sma200 != null) {
    notes.push(
      sma50 >= sma200
        ? { text: "50-day average is above the 200-day (uptrend)", tone: "up" }
        : { text: "50-day average is below the 200-day (downtrend)", tone: "down" },
    );
  }
  if (rsi14 != null) {
    notes.push(
      rsi14 >= 70
        ? { text: `RSI ${rsi14.toFixed(0)}: overbought zone, often followed by a pause`, tone: "down" }
        : rsi14 <= 30
          ? { text: `RSI ${rsi14.toFixed(0)}: oversold zone, often followed by a bounce`, tone: "up" }
          : { text: `RSI ${rsi14.toFixed(0)}: neither overbought nor oversold`, tone: "neutral" },
    );
  }
  return notes;
}
