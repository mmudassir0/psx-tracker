/**
 * PSX trades on Pakistan Standard Time (UTC+5, no DST observed). Every date
 * string in this app is a PKT calendar day so a session maps to one row
 * regardless of where the process runs.
 */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Unix seconds (as PSX returns) -> "YYYY-MM-DD" in PKT. */
export function tsToPktDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000 + PKT_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** Current PKT calendar day. */
export function todayPkt(now: Date = new Date()): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> Date at PKT midnight, for arithmetic and display. */
export function pktDateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Shift a "YYYY-MM-DD" by whole days. */
export function addDays(date: string, days: number): string {
  const d = pktDateToUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First calendar day of the year for `date`, used for YTD windows. */
export function startOfYear(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

/**
 * PSX regular session is 09:32-15:30 PKT, Monday-Friday. Used only to decide
 * whether "today" is expected to have data yet — not a trading halt check.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const day = pkt.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  return minutes >= 9 * 60 + 32 && minutes <= 15 * 60 + 30;
}
