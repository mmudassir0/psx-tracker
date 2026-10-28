/**
 * Minimal client for an OpenAI-compatible chat API. The provider follows from
 * which key is set (first wins):
 *
 *   GROQ_API_KEY   Groq, default model openai/gpt-oss-120b
 *   XAI_API_KEY    xAI Grok, default model grok-4.3
 *
 *   LLM_MODEL      optional, overrides the default model
 *   LLM_BASE_URL   optional, overrides the API host (tests use a local stub)
 *
 * Only the ingest workflow calls this, never a page view, so the key lives in
 * GitHub Actions secrets and cost is bounded by the per-run token budget in
 * src/scripts/summarise.ts.
 */

export type ProviderId = "groq" | "xai";

export interface Provider {
  id: ProviderId;
  name: string;
  baseUrl: string;
  defaultModel: string;
  keyEnv: string;
  /** USD per million tokens of the default model, for the cost estimate. */
  priceIn: number;
  priceOut: number;
  /**
   * Free-tier pacing: tokens per minute and per run (Groq's free plan allows
   * about 8,000/min and 200,000/day for gpt-oss-120b; four runs a day).
   */
  tokensPerMinute: number | null;
  tokensPerRun: number;
}

const PROVIDERS: Provider[] = [
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    keyEnv: "GROQ_API_KEY",
    priceIn: 0.15,
    priceOut: 0.6,
    tokensPerMinute: 7_000,
    tokensPerRun: 45_000,
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    keyEnv: "XAI_API_KEY",
    priceIn: 1.25,
    priceOut: 2.5,
    tokensPerMinute: null,
    tokensPerRun: 200_000,
  },
];

/** The provider whose key is set, or null when none is. */
export function llmProvider(): Provider | null {
  return PROVIDERS.find((p) => process.env[p.keyEnv]) ?? null;
}

export function llmConfigured(): boolean {
  return llmProvider() != null;
}

export function llmModel(): string {
  const p = llmProvider();
  return process.env.LLM_MODEL || p?.defaultModel || "";
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LlmError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One completion. A 429 is retried once after the server's retry-after (up to
 * a minute); other HTTP errors throw LlmError (401 = bad key).
 */
export async function llmComplete(
  messages: ChatMessage[],
  { maxTokens = 450, timeoutMs = 90_000 }: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
  const provider = llmProvider();
  if (!provider) return null;
  const key = process.env[provider.keyEnv]!;
  const url = `${(process.env.LLM_BASE_URL || provider.baseUrl).replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = { model: llmModel(), messages, temperature: 0.2 };
  if (provider.id === "groq") {
    // gpt-oss reasons before answering and its reasoning counts toward the
    // completion limit, so keep reasoning short and leave room for the answer.
    body.reasoning_effort = "low";
    body.max_completion_tokens = maxTokens + 1_000;
  } else {
    body.max_tokens = maxTokens;
  }

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 20, 60);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new LlmError(`${provider.name} API ${res.status}: ${detail}`, res.status);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new LlmError(`${provider.name} API returned an empty answer`);
      return {
        text,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
