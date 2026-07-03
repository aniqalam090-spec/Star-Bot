import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { Client as DiscordClient } from "discord.js";
import { logger } from "../lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthMode = "offline" | "microsoft";

interface MCState {
  bot: Bot;
  host: string;
  port: number;
  reportChannelId: string;
  connected: boolean;
  authMode: AuthMode;
}

// ── State ─────────────────────────────────────────────────────────────────────

const MC_USERNAME = "Itz_Iconic";
const CONTROLS = ["forward", "back", "left", "right", "jump", "sprint", "sneak"] as const;
type Control = (typeof CONTROLS)[number];

let state: MCState | null = null;
let discord: DiscordClient | null = null;
let preferredAuth: AuthMode = "offline"; // owner's saved preference

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMinecraft(client: DiscordClient) {
  discord = client;
}

// ── Auth mode ─────────────────────────────────────────────────────────────────

export function setAuthMode(mode: AuthMode) {
  preferredAuth = mode;
}

export function getAuthMode(): AuthMode {
  return preferredAuth;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function isConnected(): boolean {
  return state?.connected === true;
}

export function getMCStatus(): string {
  if (!state?.connected) return `not connected to any server (auth mode: ${preferredAuth})`;
  const pos = state.bot.entity?.position;
  const posStr = pos ? ` | pos: ${pos.x.toFixed(0)} ${pos.y.toFixed(0)} ${pos.z.toFixed(0)}` : "";
  return `connected to \`${state.host}:${state.port}\` as \`${MC_USERNAME}\` [${state.authMode}]${posStr}`;
}

// ── Discord relay ─────────────────────────────────────────────────────────────

async function reportToDiscord(channelId: string, text: string) {
  if (!discord) return;
  try {
    const ch = await discord.channels.fetch(channelId);
    if (ch && "send" in ch) await (ch as any).send(text);
  } catch { /* silently ignore */ }
}

/** Send a DM to the bot owner — used for sensitive auth codes. */
async function dmOwner(text: string) {
  if (!discord) return;
  const ownerId = process.env.DISCORD_OWNER_ID;
  if (!ownerId) return;
  try {
    const owner = await discord.users.fetch(ownerId);
    await owner.send(text);
  } catch { /* silently ignore — owner may have DMs closed */ }
}

// ── Connect ───────────────────────────────────────────────────────────────────

export async function connectToServer(
  host: string,
  port = 25565,
  reportChannelId: string,
  authOverride?: AuthMode
): Promise<string> {
  const auth = authOverride ?? preferredAuth;

  // Clean up existing connection
  if (state) {
    state.connected = false;
    state.bot.quit();
    state = null;
    await new Promise((r) => setTimeout(r, 500));
  }

  // For Microsoft auth, warn upfront — actual device code goes to owner's DMs only
  if (auth === "microsoft") {
    await reportToDiscord(
      reportChannelId,
      `**[MC]** Connecting to \`${host}:${port}\` with Microsoft auth — if re-auth is needed I'll DM you the code.`
    );
  }

  return new Promise((resolve, reject) => {
    // Microsoft auth can take several minutes for the user to complete;
    // offline mode should connect in seconds.
    const TIMEOUT_MS = auth === "microsoft" ? 5 * 60 * 1000 : 20_000;

    const botOptions: Parameters<typeof mineflayer.createBot>[0] = {
      host,
      port,
      username: MC_USERNAME,
      auth: auth === "microsoft" ? "microsoft" : "offline",
      // Cache Microsoft tokens so re-auth isn't needed every session
      profilesFolder: auth === "microsoft" ? "/tmp/mc-auth" : (undefined as any),
      hideErrors: false,
    };

    // Intercept the Microsoft device-code prompt and send it to Discord
    // instead of printing to stdout (where the owner can't see it).
    if (auth === "microsoft") {
      (botOptions as any).onMsaCode = async (data: {
        user_code: string;
        verification_uri: string;
        expires_in: number;
      }) => {
        const mins = Math.floor(data.expires_in / 60);
        // DM the owner — never post credentials to a shared channel
        await dmOwner(
          `**[MC Auth]** Open **<${data.verification_uri}>** and enter code \`${data.user_code}\`\n` +
            `*(expires in ${mins} minute${mins === 1 ? "" : "s"})*`
        );
        // Let the channel know the code was sent privately
        await reportToDiscord(reportChannelId, "**[MC]** Auth code sent to your DMs — complete sign-in there to continue.");
      };
    }

    const bot = mineflayer.createBot(botOptions);

    const timer = setTimeout(() => {
      bot.quit();
      reject(new Error(
        auth === "microsoft"
          ? "Microsoft auth timed out (5 min) — make sure you entered the device code in time"
          : "connection timed out after 20s"
      ));
    }, TIMEOUT_MS);

    bot.once("spawn", () => {
      clearTimeout(timer);
      state = { bot, host, port, reportChannelId, connected: true, authMode: auth };

      // Forward server chat — never echo own messages (prevents chat loops)
      bot.on("chat", (username: string, message: string) => {
        if (username === MC_USERNAME) return;
        void reportToDiscord(reportChannelId, `**[MC]** <${username}> ${message}`);
      });

      bot.on("death", () => {
        void reportToDiscord(reportChannelId, "**[MC]** died — respawning");
        bot.respawn();
      });

      bot.on("kicked", (reason: unknown) => {
        void reportToDiscord(reportChannelId, `**[MC]** got kicked: ${String(reason)}`);
        state = null;
      });

      bot.on("error", (err: Error) => {
        logger.error({ err }, "Minecraft bot error");
        if (state) state.connected = false;
        state = null;
      });

      bot.on("end", () => {
        if (state?.connected) {
          void reportToDiscord(reportChannelId, "**[MC]** disconnected from server");
        }
        state = null;
      });

      resolve(`✅ connected to \`${host}:${port}\` as \`${MC_USERNAME}\` [${auth}]`);
    });

    bot.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export function disconnect(): string {
  if (!state) return "not connected to any server";
  const { host, port } = state;
  state.connected = false;
  state.bot.quit();
  state = null;
  return `disconnected from \`${host}:${port}\``;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export function sendChat(message: string): string {
  if (!state?.connected) return "not connected to a server";
  const safe = message.slice(0, 240);
  state.bot.chat(safe);
  return `said in game: "${safe}"`;
}

// ── Movement ──────────────────────────────────────────────────────────────────

const DIRECTION_MAP: Record<string, Control> = {
  forward: "forward", north: "forward",
  back: "back", backward: "back", south: "back",
  left: "left", west: "left",
  right: "right", east: "right",
  jump: "jump",
  sneak: "sneak",
  sprint: "sprint",
};

export async function doMove(direction: string, durationMs = 1000): Promise<string> {
  if (!state?.connected) return "not connected to a server";

  const control = DIRECTION_MAP[direction.toLowerCase()];
  if (!control) return `unknown direction: "${direction}"`;

  const capped = Math.min(durationMs, 10_000);
  state.bot.setControlState(control, true);
  await new Promise((r) => setTimeout(r, capped));
  if (state?.connected) state.bot.setControlState(control, false);

  return `moved ${direction} for ${capped / 1000}s`;
}

export function stopAll(): string {
  if (!state?.connected) return "not connected";
  for (const k of CONTROLS) state.bot.setControlState(k, false);
  return "stopped all movement";
}

// ── Info ──────────────────────────────────────────────────────────────────────

export function getPos(): string {
  if (!state?.connected) return "not connected";
  const pos = state.bot.entity?.position;
  if (!pos) return "position unknown";
  return `x=${pos.x.toFixed(1)} y=${pos.y.toFixed(1)} z=${pos.z.toFixed(1)}`;
}

export function getHealth(): string {
  if (!state?.connected) return "not connected";
  const { health, food } = state.bot;
  return `health: ${(health ?? 0).toFixed(1)}/20 | food: ${food ?? 0}/20`;
}
