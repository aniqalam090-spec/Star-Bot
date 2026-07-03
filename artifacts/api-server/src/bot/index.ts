import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
} from "discord.js";
import { onMessage } from "./handlers";
import { initMinecraft } from "./minecraft";
import { logger } from "../lib/logger";

function validateEnv() {
  const required = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_OWNER_ID",
    "GROQ_API_KEY",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Discord bot cannot start — missing required env vars: ${missing.join(", ")}`
    );
  }

  // Sanity-check: owner ID must look like a Discord snowflake (17–20 digits)
  const ownerId = process.env.DISCORD_OWNER_ID!;
  if (!/^\d{17,20}$/.test(ownerId)) {
    throw new Error(
      `DISCORD_OWNER_ID "${ownerId}" does not look like a valid Discord user ID`
    );
  }
}

export async function startBot() {
  validateEnv();

  const token = process.env.DISCORD_BOT_TOKEN!;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info(
      { tag: c.user.tag, ownerId: process.env.DISCORD_OWNER_ID },
      "Discord bot ready"
    );
    initMinecraft(client);
  });

  client.on(Events.MessageCreate, (msg: Message) => {
    onMessage(client, msg).catch((err) =>
      logger.error({ err }, "Unhandled error in message handler")
    );
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
}
