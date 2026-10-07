export interface SymbolEntry {
  s: string;
  n: string | null;
  sec: string | null;
}

const MAX_RESULTS = 8;

/** Best matches first: exact symbol, symbol prefix, name word prefix, anywhere. */
export function rankSymbols(list: SymbolEntry[], query: string): SymbolEntry[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const scored: { e: SymbolEntry; score: number }[] = [];
  for (const e of list) {
    const name = (e.n ?? "").toUpperCase();
    let score = 0;
    if (e.s === q) score = 100;
    else if (e.s.startsWith(q)) score = 80 - e.s.length;
    else if (name.startsWith(q)) score = 60;
    else if (name.split(/[\s.&(),-]+/).some((w) => w.startsWith(q))) score = 50;
    else if (e.s.includes(q)) score = 30;
    else if (name.includes(q)) score = 20;
    if (score > 0) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.s.localeCompare(b.e.s))
    .slice(0, MAX_RESULTS)
    .map((x) => x.e);
}
