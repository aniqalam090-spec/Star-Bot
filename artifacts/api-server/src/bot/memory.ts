import { db } from "@workspace/db";
import {
  discordUsers,
  discordMemories,
  discordMessages,
  discordConfig,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const HISTORY_LIMIT = 20;
/** Sentinel stored in userId column for global (non-user-specific) memories */
const GLOBAL = "__global__";

// ── Users ──────────────────────────────────────────────────────────────────

export async function upsertUser(
  discordId: string,
  username: string,
  displayName?: string
) {
  const isOwner = discordId === process.env.DISCORD_OWNER_ID;
  const existing = await db.query.discordUsers.findFirst({
    where: eq(discordUsers.discordId, discordId),
  });

  if (existing) {
    await db
      .update(discordUsers)
      .set({ username, displayName: displayName ?? null, lastSeen: new Date() })
      .where(eq(discordUsers.discordId, discordId));
  } else {
    await db.insert(discordUsers).values({
      discordId,
      username,
      displayName: displayName ?? null,
      isOwner,
    });
  }
}

// ── Conversation history ───────────────────────────────────────────────────

export async function getChannelHistory(channelId: string) {
  const rows = await db.query.discordMessages.findMany({
    where: eq(discordMessages.channelId, channelId),
    orderBy: [desc(discordMessages.createdAt)],
    limit: HISTORY_LIMIT,
  });
  return rows.reverse();
}

export async function saveMessage(params: {
  channelId: string;
  guildId: string | null;
  userId: string;
  username: string;
  role: "user" | "assistant";
  content: string;
}) {
  await db.insert(discordMessages).values(params);
}

export async function clearChannelHistory(channelId: string) {
  await db.delete(discordMessages).where(eq(discordMessages.channelId, channelId));
}

// ── Memories ───────────────────────────────────────────────────────────────

export async function getUserMemories(userId: string) {
  return db.query.discordMemories.findMany({
    where: eq(discordMemories.userId, userId),
    orderBy: [desc(discordMemories.updatedAt)],
  });
}

export async function getGlobalMemories() {
  return db.query.discordMemories.findMany({
    where: eq(discordMemories.userId, GLOBAL),
    orderBy: [desc(discordMemories.updatedAt)],
  });
}

/**
 * Atomically upsert a memory. Uses PostgreSQL ON CONFLICT so concurrent
 * writes don't create duplicates.
 */
export async function upsertMemory(
  userId: string | null,
  key: string,
  value: string
) {
  const effectiveUserId = userId ?? GLOBAL;
  await db
    .insert(discordMemories)
    .values({ userId: effectiveUserId, memoryKey: key, value })
    .onConflictDoUpdate({
      target: [discordMemories.userId, discordMemories.memoryKey],
      set: { value, updatedAt: new Date() },
    });
}

export async function deleteMemoryById(id: number) {
  await db.delete(discordMemories).where(eq(discordMemories.id, id));
}

export async function listAllMemories() {
  return db.query.discordMemories.findMany({
    orderBy: [desc(discordMemories.updatedAt)],
  });
}

export async function listUserMemories(userId: string) {
  return db.query.discordMemories.findMany({
    where: eq(discordMemories.userId, userId),
    orderBy: [desc(discordMemories.updatedAt)],
  });
}

// ── Config ─────────────────────────────────────────────────────────────────

export async function getConfig(key: string): Promise<string | null> {
  const row = await db.query.discordConfig.findFirst({
    where: eq(discordConfig.configKey, key),
  });
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string) {
  await db
    .insert(discordConfig)
    .values({ configKey: key, value })
    .onConflictDoUpdate({
      target: [discordConfig.configKey],
      set: { value, updatedAt: new Date() },
    });
}
