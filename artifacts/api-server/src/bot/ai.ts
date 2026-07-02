import Groq from "groq-sdk";
import { logger } from "../lib/logger";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Primary model — best quality
const PRIMARY_MODEL = "llama-3.3-70b-versatile";
// Fast model for background tasks like memory extraction
const FAST_MODEL = "llama-3.1-8b-instant";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateResponse(messages: ChatMessage[]): Promise<string> {
  try {
    const completion = await groq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages,
      temperature: 0.88,
      max_tokens: 1024,
      top_p: 0.95,
    });

    return (
      completion.choices[0]?.message?.content?.trim() ??
      "something went wrong on my end, sorry"
    );
  } catch (err: unknown) {
    logger.error({ err }, "Groq generation error");
    // Check Groq SDK structured error shape before falling back to message string
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status: unknown }).status
        : null;
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 429 || msg.includes("rate_limit") || msg.includes("429")) {
      return "hitting rate limits rn, try again in a sec";
    }
    if (status === 503 || status === 504 || msg.includes("timeout") || msg.includes("503")) {
      return "groq is taking too long to respond right now, try again in a moment";
    }
    throw err;
  }
}

export interface MemoryExtract {
  userId: string | null;
  key: string;
  value: string;
}

export async function extractMemories(
  conversationSnippet: string,
  existingKeys: string
): Promise<MemoryExtract[]> {
  try {
    const completion = await groq.chat.completions.create({
      model: FAST_MODEL,
      messages: [
        {
          role: "system",
          content: `Extract important facts worth remembering long-term from this conversation.
Return ONLY valid JSON array. Each item: {"userId":"<discord_id or null>","key":"<short topic>","value":"<what to remember>"}
Rules:
- Only extract genuinely useful facts: names, preferences, important details, relationships
- userId = Discord user ID if about a specific person, null if general/global
- If nothing notable, return []
- Max 4 items, no duplicates of: ${existingKeys || "none"}`,
        },
        { role: "user", content: conversationSnippet },
      ],
      temperature: 0.1,
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]) as MemoryExtract[];
  } catch {
    return [];
  }
}
