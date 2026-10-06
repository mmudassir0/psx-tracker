/**
 * Which stocks moved the index today, in index points.
 *
 * A stock's pull on a cap-weighted index is its weight at the previous close
 * times its own return: a heavyweight's +0.4% moves the index more than a
 * small name's +2%. Weights here are uncapped free-float caps (PSX caps single
 * names in the live index), so the contributions add up to the uncapped move
 * and can differ slightly from the published one; both are returned.
 */

export interface MoverInput {
  symbol: string;
  name: string | null;
  close: number | null;
  ldcp: number | null;
  freeFloatShares: number | null;
}

export interface IndexContribution {
  symbol: string;
  name: string | null;
  points: number;
  changePct: number;
  /** Weight at the previous close, %. */
  weightPct: number;
}

export interface IndexMovers {
  rows: IndexContribution[];
  /** Sum of the contributions (uncapped). */
  explainedPoints: number;
  /** Published move, when the level and its change are known. */
  actualPoints: number | null;
  previousLevel: number | null;
}

export function computeIndexMovers(
  constituents: MoverInput[],
  level: { current: number; change?: number | null; changePct?: number | null } | null,
): IndexMovers {
  const usable = constituents.filter(
    (c): c is MoverInput & { close: number; ldcp: number; freeFloatShares: number } =>
      c.close != null && c.ldcp != null && c.ldcp > 0 && c.freeFloatShares != null && c.freeFloatShares > 0,
  );

  let previousLevel: number | null = null;
  let actualPoints: number | null = null;
  if (level) {
    if (level.change != null) {
      previousLevel = level.current - level.change;
      actualPoints = level.change;
    } else if (level.changePct != null && level.changePct > -100) {
      previousLevel = level.current / (1 + level.changePct / 100);
      actualPoints = level.current - previousLevel;
    }
  }

  const previousCap = usable.reduce((sum, c) => sum + c.freeFloatShares * c.ldcp, 0);
  if (previousCap <= 0 || previousLevel == null) {
    return { rows: [], explainedPoints: 0, actualPoints, previousLevel };
  }

  const rows = usable
    .map((c) => {
      const weight = (c.freeFloatShares * c.ldcp) / previousCap;
      const ret = c.close / c.ldcp - 1;
      return {
        symbol: c.symbol,
        name: c.name,
        points: previousLevel! * weight * ret,
        changePct: ret * 100,
        weightPct: weight * 100,
      };
    })
    .sort((a, b) => b.points - a.points);

  return {
    rows,
    explainedPoints: rows.reduce((sum, r) => sum + r.points, 0),
    actualPoints,
    previousLevel,
  };
}
