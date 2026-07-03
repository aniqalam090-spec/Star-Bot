import { type Message as DiscordMessage, type GuildTextBasedChannel } from "discord.js";
import {
  upsertMemory,
  deleteMemoryById,
  listAllMemories,
  listUserMemories,
  clearChannelHistory,
  setConfig,
  getConfig,
} from "./memory";
import { getMCStatus, disconnect as mcDisconnect } from "./minecraft";
import { logger } from "../lib/logger";

const OWNER_ID = process.env.DISCORD_OWNER_ID!;

function isOwner(userId: string) {
  return userId === OWNER_ID;
}

/** Split long text into ≤1990-char chunks for Discord */
function chunk(text: string): string[] {
  const parts: string[] = [];
  while (text.length > 0) {
    parts.push(text.slice(0, 1990));
    text = text.slice(1990);
  }
  return parts;
}

async function sendChunked(msg: DiscordMessage, text: string) {
  if (!msg.channel.isSendable()) return;
  for (const part of chunk(text)) {
    await msg.channel.send(part);
  }
}

export async function handleCommand(msg: DiscordMessage): Promise<boolean> {
  const content = msg.content.trim();
  if (!content.startsWith("!")) return false;

  const [rawCmd, ...rest] = content.slice(1).split(" ");
  const cmd = rawCmd?.toLowerCase();
  const args = rest.join(" ").trim();

  if (!cmd) return false;

  // Non-owner commands
  if (cmd === "help") {
    if (!isOwner(msg.author.id)) {
      await msg.reply("you can @ me or reply to me to chat");
      return true;
    }
    const help = [
      "**Owner commands:**",
      "`!remember <fact>` — save a global memory",
      "`!rememberuser <@user> <fact>` — save a memory about a specific user",
      "`!forget <id>` — delete a memory by ID",
      "`!memories` — list all stored memories",
      "`!usermemories <@user>` — list memories for a user",
      "`!clearctx` — wipe conversation history in this channel",
      "`!botname <name>` — set the bot's display name in prompts",
      "`!botpersonality <description>` — set a custom personality note",
      "`!stats` — see bot stats",
    ].join("\n");
    await msg.reply(help);
    return true;
  }

  // All commands below are owner-only
  if (!isOwner(msg.author.id)) {
    // Silently ignore — don't tip off non-owners that these commands exist
    return true;
  }

  switch (cmd) {
    case "remember": {
      if (!args) {
        await msg.reply("usage: `!remember <fact to remember>`");
        return true;
      }
      // Try to auto-generate a key from the first few words
      const key = args.split(" ").slice(0, 4).join("_").toLowerCase().replace(/[^a-z0-9_]/g, "");
      await upsertMemory(null, key || "note", args);
      await msg.reply(`got it, i'll remember that`);
      return true;
    }

    case "rememberuser": {
      const mentionMatch = args.match(/<@!?(\d+)>/);
      if (!mentionMatch) {
        await msg.reply("usage: `!rememberuser @user <fact>`");
        return true;
      }
      const userId = mentionMatch[1]!;
      const fact = args.replace(/<@!?\d+>/, "").trim();
      if (!fact) {
        await msg.reply("what should i remember about them?");
        return true;
      }
      const key = fact.split(" ").slice(0, 4).join("_").toLowerCase().replace(/[^a-z0-9_]/g, "");
      await upsertMemory(userId, key || "note", fact);
      await msg.reply(`saved`);
      return true;
    }

    case "forget": {
      const id = parseInt(args, 10);
      if (isNaN(id)) {
        await msg.reply("usage: `!forget <memory id>` — use `!memories` to see IDs");
        return true;
      }
      await deleteMemoryById(id);
      await msg.reply(`memory ${id} deleted`);
      return true;
    }

    case "memories": {
      const all = await listAllMemories();
      if (all.length === 0) {
        await msg.reply("no stored memories yet");
        return true;
      }
      const lines = all.map(
        (m) =>
          `[${m.id}] ${m.userId ? `<@${m.userId}>` : "global"} · **${m.memoryKey}**: ${m.value}`
      );
      await sendChunked(msg, lines.join("\n"));
      return true;
    }

    case "usermemories": {
      const mentionMatch = args.match(/<@!?(\d+)>/);
      if (!mentionMatch) {
        await msg.reply("usage: `!usermemories @user`");
        return true;
      }
      const userId = mentionMatch[1]!;
      const mems = await listUserMemories(userId);
      if (mems.length === 0) {
        await msg.reply(`no memories stored for <@${userId}>`);
        return true;
      }
      const lines = mems.map((m) => `[${m.id}] **${m.memoryKey}**: ${m.value}`);
      await sendChunked(msg, `Memories for <@${userId}>:\n` + lines.join("\n"));
      return true;
    }

    case "clearctx": {
      await clearChannelHistory(msg.channelId);
      await msg.reply("conversation history cleared for this channel");
      return true;
    }

    case "botname": {
      if (!args) {
        await msg.reply("usage: `!botname <name>`");
        return true;
      }
      await setConfig("bot_name", args);
      await msg.reply(`name updated to "${args}"`);
      return true;
    }

    case "botpersonality": {
      if (!args) {
        await msg.reply("usage: `!botpersonality <description>`");
        return true;
      }
      await setConfig("bot_personality", args);
      await msg.reply(`personality note updated`);
      return true;
    }

    case "stats": {
      const all = await listAllMemories();
      const global = all.filter((m) => !m.userId).length;
      const userMems = all.filter((m) => !!m.userId).length;
      await msg.reply(
        `**Bot stats**\n` +
          `memories: ${all.length} total (${global} global, ${userMems} user-specific)\n` +
          `uptime: ${Math.floor(process.uptime() / 60)}m`
      );
      return true;
    }

    case "mcstatus": {
      await msg.reply(getMCStatus());
      return true;
    }

    case "mcdisconnect": {
      await msg.reply(mcDisconnect());
      return true;
    }

    default:
      return false; // Not a recognized command — fall through to AI
  }
}
