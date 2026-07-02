import { db } from "@workspace/db";
import {
  discordUsers,
  discordMemories,
  discordMessages,
  discordConfig,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const HISTORY_LIMIT = 18;
const GLOBAL = "__global__";

// ── In-memory cache ────────────────────────────────────────────────────────
// Avoids a DB round-trip on every single message. Invalidated on every write.

interface CacheEntry<T> {
  data: T;
  expires: number;
}

type Memory = typeof discordMemories.$inferSelect;
type ConfigVal = string | null;

const userMemCache = new Map<string, CacheEntry<Memory[]>>();
const configCache = new Map<string, CacheEntry<ConfigVal>>();
let globalMemCache: CacheEntry<Memory[]> | null = null;

const USER_MEM_TTL   = 2 * 60_000;  //  2 min
const GLOBAL_MEM_TTL = 5 * 60_000;  //  5 min
const CONFIG_TTL     = 10 * 60_000; // 10 min

function hit<T>(entry: CacheEntry<T> | null | undefined): T | null {
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

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

// ── Memories (with cache) ──────────────────────────────────────────────────

export async function getUserMemories(userId: string): Promise<Memory[]> {
  const cached = hit(userMemCache.get(userId));
  if (cached) return cached;

  const rows = await db.query.discordMemories.findMany({
    where: eq(discordMemories.userId, userId),
    orderBy: [desc(discordMemories.updatedAt)],
  });
  userMemCache.set(userId, { data: rows, expires: Date.now() + USER_MEM_TTL });
  return rows;
}

export async function getGlobalMemories(): Promise<Memory[]> {
  const cached = hit(globalMemCache);
  if (cached) return cached;

  const rows = await db.query.discordMemories.findMany({
    where: eq(discordMemories.userId, GLOBAL),
    orderBy: [desc(discordMemories.updatedAt)],
  });
  globalMemCache = { data: rows, expires: Date.now() + GLOBAL_MEM_TTL };
  return rows;
}

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

  // Invalidate cache for the affected scope
  if (effectiveUserId === GLOBAL) {
    globalMemCache = null;
  } else {
    userMemCache.delete(effectiveUserId);
  }
}

export async function deleteMemoryById(id: number) {
  // Can't know userId without querying first — just nuke all caches on delete
  userMemCache.clear();
  globalMemCache = null;
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

// ── Config (with cache) ────────────────────────────────────────────────────

export async function getConfig(key: string): Promise<ConfigVal> {
  const cached = hit(configCache.get(key));
  // null is a valid cached value (key doesn't exist)
  if (cached !== null || configCache.has(key)) {
    const entry = configCache.get(key);
    if (entry && Date.now() < entry.expires) return entry.data;
  }

  const row = await db.query.discordConfig.findFirst({
    where: eq(discordConfig.configKey, key),
  });
  const val = row?.value ?? null;
  configCache.set(key, { data: val, expires: Date.now() + CONFIG_TTL });
  return val;
}

export async function setConfig(key: string, value: string) {
  await db
    .insert(discordConfig)
    .values({ configKey: key, value })
    .onConflictDoUpdate({
      target: [discordConfig.configKey],
      set: { value, updatedAt: new Date() },
    });
  configCache.delete(key); // invalidate
}
