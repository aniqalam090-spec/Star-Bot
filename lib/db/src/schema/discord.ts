import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const discordUsers = pgTable("discord_users", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  isOwner: boolean("is_owner").notNull().default(false),
  firstSeen: timestamp("first_seen").notNull().defaultNow(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
});

export const discordMemories = pgTable(
  "discord_memories",
  {
    id: serial("id").primaryKey(),
    // '__global__' sentinel means a global/bot-level memory (not user-specific).
    // Avoids nullable unique constraint issues in PostgreSQL.
    userId: text("user_id").notNull().default("__global__"),
    memoryKey: text("memory_key").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("discord_memories_user_key_idx").on(t.userId, t.memoryKey)]
);

export const discordMessages = pgTable("discord_messages", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  guildId: text("guild_id"),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const discordConfig = pgTable("discord_config", {
  id: serial("id").primaryKey(),
  configKey: text("config_key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
