import Groq from "groq-sdk";
import { logger } from "../lib/logger";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PRIMARY_MODEL = "llama-3.3-70b-versatile";
const FAST_MODEL    = "llama-3.1-8b-instant";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Pick a token budget based on rough message complexity.
 * Simple one-liners get a tight budget — faster response, fewer tokens burned.
 */
function tokenBudget(lastUserMsg: string): number {
  const len = lastUserMsg.length;
  if (len < 60)  return 280;  // quick reply for short questions
  if (len < 200) return 560;
  return 850;                 // full budget for detailed questions
}

function classifyError(err: unknown): "rate_limit" | "timeout" | "other" {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status: unknown }).status
      : null;
  const msg = err instanceof Error ? err.message : String(err);

  if (status === 429 || msg.includes("rate_limit") || msg.includes("429"))
    return "rate_limit";
  if (
    status === 503 || status === 504 ||
    msg.includes("timeout") || msg.includes("503") || msg.includes("504")
  )
    return "timeout";
  return "other";
}

export async function generateResponse(messages: ChatMessage[]): Promise<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const max_tokens = tokenBudget(lastUser);

  try {
    const completion = await groq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages,
      temperature: 0.88,
      max_tokens,
      top_p: 0.95,
    });
    return (
      completion.choices[0]?.message?.content?.trim() ??
      "something went wrong on my end, sorry"
    );
  } catch (err) {
    logger.error({ err }, "Groq generation error");
    const kind = classifyError(err);
    if (kind === "rate_limit") return "hitting rate limits rn — give me a second and try again";
    if (kind === "timeout")    return "groq is taking forever right now, try again in a moment";
    throw err;
  }
}

export interface MemoryExtract {
  userId: string | null;
  key: string;
  value: string;
}

/**
 * Extract memorable facts from one exchange (user message + bot reply).
 * Uses the fast model — never blocks the main response.
 */
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
- userId must always be "${userId}" (this is a per-user extraction)
- Only extract real facts: name, age, location, job, preferences, opinions, relationships, goals, hobbies
- Skip anything trivial, conversational, or already known: ${existingKeys || "none"}
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
