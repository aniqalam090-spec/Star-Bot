import Groq from "groq-sdk";
import { logger } from "../lib/logger";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Model cascade — tried in order, falls back on rate limit / timeout
const MODELS = [
  "meta-llama/llama-4-maverick-17b-128e-instruct", // best available on Groq
  "llama-3.3-70b-versatile",                        // reliable 70b
  "llama-3.1-8b-instant",                           // fast fallback
];
const FAST_MODEL = "llama-3.1-8b-instant";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function tokenBudget(lastUserMsg: string): number {
  const len = lastUserMsg.length;
  if (len < 60)  return 280;
  if (len < 200) return 560;
  return 850;
}

function isRateLimit(err: unknown): boolean {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status: unknown }).status
      : null;
  const msg = err instanceof Error ? err.message : String(err);
  return status === 429 || msg.includes("rate_limit") || msg.includes("429");
}

function isTimeout(err: unknown): boolean {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status: unknown }).status
      : null;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    status === 503 || status === 504 ||
    msg.includes("timeout") || msg.includes("503") || msg.includes("504")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGroq(
  model: string,
  messages: ChatMessage[],
  max_tokens: number
): Promise<string> {
  const completion = await groq.chat.completions.create({
    model,
    messages,
    temperature: 0.88,
    max_tokens,
    top_p: 0.95,
  });
  return (
    completion.choices[0]?.message?.content?.trim() ??
    "something went wrong on my end"
  );
}

export async function generateResponse(messages: ChatMessage[]): Promise<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const max_tokens = tokenBudget(lastUser);

  // Walk through the cascade — biggest/best first, smaller as fallback
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i]!;
    const isLast = i === MODELS.length - 1;

    try {
      const result = await callGroq(model, messages, max_tokens);
      if (i > 0) logger.info({ model }, "Used fallback model");
      return result;
    } catch (err) {
      const soft = isRateLimit(err) || isTimeout(err);
      if (!soft) {
        logger.error({ err, model }, "Groq hard error");
        throw err;
      }
      logger.warn({ model, next: MODELS[i + 1] ?? "none" }, "Model unavailable — trying next");
      if (!isLast) await sleep(i === 0 ? 1200 : 2500);
    }
  }

  // All models exhausted
  return "swamped rn, gimme a sec and try again";
}

export interface MemoryExtract {
  userId: string | null;
  key: string;
  value: string;
}

export async function extractMemories(
  userMsg: string,
  botReply: string,
  userId: string,
  existingKeys: string
): Promise<MemoryExtract[]> {
  try {
    const completion = await groq.chat.completions.create({
      model: FAST_MODEL,
      messages: [
        {
          role: "system",
          content: `Extract long-term-worthy facts from this single exchange.
Return ONLY valid JSON array. Each item: {"userId":"${userId}","key":"<topic>","value":"<fact>"}
Rules:
- userId must always be "${userId}"
- Only extract real facts: name, age, location, job, preferences, opinions, relationships, goals, hobbies
- Skip trivial or conversational content, and anything already known: ${existingKeys || "none"}
- If nothing notable, return []
- Max 3 items`,
        },
        {
          role: "user",
          content: `User said: ${userMsg}\nBot replied: ${botReply}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]) as MemoryExtract[];
  } catch {
    return [];
  }
}
