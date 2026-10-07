import { getTrackedIndexCodes } from "@/lib/market";
import { DEFAULT_INDEX } from "@/lib/psx/indices";
import { getUserSetting } from "@/lib/settings";

/**
 * The index a user compares their portfolio with: index weights, the
 * "same money in the index" line and beta. KSE100 unless they pick another.
 */
export async function getBenchmarkIndex(userId: string | null): Promise<string> {
  const saved = await getUserSetting(userId, "benchmark", { index: DEFAULT_INDEX });
  const tracked = await getTrackedIndexCodes();
  return tracked.includes(saved.index) ? saved.index : DEFAULT_INDEX;
}
