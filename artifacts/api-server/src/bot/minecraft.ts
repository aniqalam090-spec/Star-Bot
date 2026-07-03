import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { Client as DiscordClient } from "discord.js";
import { logger } from "../lib/logger";

const MC_USERNAME = "Itz_Iconic";
const CONNECT_TIMEOUT_MS = 15_000;
const CONTROLS = ["forward", "back", "left", "right", "jump", "sprint", "sneak"] as const;
type Control = (typeof CONTROLS)[number];

interface MCState {
  bot: Bot;
  host: string;
  port: number;
  reportChannelId: string;
  connected: boolean;
}

let state: MCState | null = null;
let discord: DiscordClient | null = null;

export function initMinecraft(client: DiscordClient) {
  discord = client;
}

export function isConnected(): boolean {
  return state?.connected === true;
}

export function getMCStatus(): string {
  if (!state?.connected) return "not connected to any server";
  const pos = state.bot.entity?.position;
  const posStr = pos ? ` | pos: ${pos.x.toFixed(0)} ${pos.y.toFixed(0)} ${pos.z.toFixed(0)}` : "";
  return `connected to \`${state.host}:${state.port}\` as \`${MC_USERNAME}\`${posStr}`;
}

async function reportToDiscord(channelId: string, text: string) {
  if (!discord) return;
  try {
    const ch = await discord.channels.fetch(channelId);
    if (ch && "send" in ch) await (ch as any).send(text);
  } catch { /* silently ignore */ }
}

// ── Connect ──────────────────────────────────────────────────────────────────

export async function connectToServer(
  host: string,
  port = 25565,
  reportChannelId: string
): Promise<string> {
  // Clean up existing connection first
  if (state) {
    state.connected = false;
    state.bot.quit();
    state = null;
    await new Promise((r) => setTimeout(r, 500));
  }

  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({
      host,
      port,
      username: MC_USERNAME,
      auth: "offline",
      // version omitted — auto-detect from server
      hideErrors: false,
    });

    const timer = setTimeout(() => {
      bot.quit();
      reject(new Error("connection timed out after 15s"));
    }, CONNECT_TIMEOUT_MS);

    bot.once("spawn", () => {
      clearTimeout(timer);
      state = { bot, host, port, reportChannelId, connected: true };

      // Forward chat — never echo own messages (no chat loops)
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

      resolve(`✅ connected to \`${host}:${port}\` as \`${MC_USERNAME}\``);
    });

    bot.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Disconnect ───────────────────────────────────────────────────────────────

export function disconnect(): string {
  if (!state) return "not connected to any server";
  const { host, port } = state;
  state.connected = false;
  state.bot.quit();
  state = null;
  return `disconnected from \`${host}:${port}\``;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export function sendChat(message: string): string {
  if (!state?.connected) return "not connected to a server";
  const safe = message.slice(0, 240);
  state.bot.chat(safe);
  return `said in game: "${safe}"`;
}

// ── Movement ─────────────────────────────────────────────────────────────────

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

// ── Info ─────────────────────────────────────────────────────────────────────

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
