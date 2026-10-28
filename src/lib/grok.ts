/**
 * Minimal client for xAI's Grok chat API (OpenAI-compatible).
 *
 *   XAI_API_KEY   required; without it every call returns null
 *   XAI_MODEL     optional, default grok-4.3 (cheapest current Grok)
 *   XAI_BASE_URL  optional, default https://api.x.ai/v1
 *
 * Only the ingest workflow calls this, never a page view, so the key lives in
 * GitHub Actions secrets and cost is bounded by how many summaries a run asks
 * for (see src/scripts/summarise.ts).
 */
/** XAI_BASE_URL overrides the API host (tests point it at a local stub). */
function endpoint(): string {
  return `${(process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "")}/chat/completions`;
}
export const DEFAULT_MODEL = "grok-4.3";

export function grokConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

export function grokModel(): string {
  return process.env.XAI_MODEL || DEFAULT_MODEL;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class GrokError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GrokError";
  }
}

/** One completion. Throws GrokError on HTTP errors (401 = bad key, 429 = rate/credit). */
export async function grokComplete(
  messages: ChatMessage[],
  { maxTokens = 450, timeoutMs = 60_000 }: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: grokModel(),
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new GrokError(`xAI API ${res.status}: ${detail}`, res.status);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new GrokError("xAI API returned an empty answer");
    return {
      text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
