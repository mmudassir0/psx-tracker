import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { portfolios, transactions } from "@/db/schema";

export interface PortfolioInfo {
  id: string;
  name: string;
  createdAt: Date;
}

export const DEFAULT_PORTFOLIO_NAME = "Main";
export const MAX_PORTFOLIOS = 20;

/** The user's portfolios, oldest first; the first one is their default. */
export async function listPortfolios(userId: string | null): Promise<PortfolioInfo[]> {
  if (!userId) return [];
  return await db
    .select({ id: portfolios.id, name: portfolios.name, createdAt: portfolios.createdAt })
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .orderBy(asc(portfolios.createdAt), asc(portfolios.id))
    .all();
}

/** Id of the user's default portfolio, creating "Main" on first use. */
export async function ensureDefaultPortfolio(userId: string): Promise<string> {
  const [first] = await listPortfolios(userId);
  if (first) return first.id;
  const id = randomUUID();
  await db
    .insert(portfolios)
    .values({ id, userId, name: DEFAULT_PORTFOLIO_NAME, createdAt: new Date() })
    .run();
  return id;
}

/** Is this portfolio id one of the user's own? Ids come from forms and URLs. */
export async function ownsPortfolio(userId: string, portfolioId: string): Promise<boolean> {
  const row = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .get();
  return Boolean(row);
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function createPortfolio(
  userId: string,
  name: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, message: "Give the portfolio a name." };
  const existing = await listPortfolios(userId);
  if (existing.length >= MAX_PORTFOLIOS) {
    return { ok: false, message: `You can have up to ${MAX_PORTFOLIOS} portfolios.` };
  }
  if (existing.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, message: `You already have a portfolio called "${clean}".` };
  }
  // Make sure the default exists first, so the new one is never the default.
  if (existing.length === 0) await ensureDefaultPortfolio(userId);
  const id = randomUUID();
  await db.insert(portfolios).values({ id, userId, name: clean, createdAt: new Date() }).run();
  return { ok: true, id };
}

export async function renamePortfolio(
  userId: string,
  portfolioId: string,
  name: string,
): Promise<{ ok: boolean; message: string }> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, message: "Give the portfolio a name." };
  if (!(await ownsPortfolio(userId, portfolioId))) return { ok: false, message: "Portfolio not found." };
  const others = (await listPortfolios(userId)).filter((p) => p.id !== portfolioId);
  if (others.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, message: `You already have a portfolio called "${clean}".` };
  }
  await db
    .update(portfolios)
    .set({ name: clean })
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .run();
  return { ok: true, message: "Renamed." };
}

/**
 * Only an empty portfolio can be deleted, and never the last one: deleting
 * trades by accident would silently rewrite tax and zakat figures.
 */
export async function deletePortfolio(
  userId: string,
  portfolioId: string,
): Promise<{ ok: boolean; message: string }> {
  const all = await listPortfolios(userId);
  if (!all.some((p) => p.id === portfolioId)) return { ok: false, message: "Portfolio not found." };
  if (all.length === 1) return { ok: false, message: "You need at least one portfolio." };
  const used = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.portfolioId, portfolioId)))
    .get();
  if ((used?.n ?? 0) > 0) {
    return { ok: false, message: "Move or delete its transactions first; only an empty portfolio can be deleted." };
  }
  await db
    .delete(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .run();
  return { ok: true, message: "Deleted." };
}
