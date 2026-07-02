# StarAiBot — Discord AI Bot

A Discord bot powered by Groq (llama-3.3-70b-versatile) with persistent memory, owner permissions for Aniq Alam, and anti-impersonation protection.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `GROQ_API_KEY`, `DISCORD_OWNER_ID`, `DISCORD_OWNER_USERNAME`, `DISCORD_OWNER_NAME`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Discord: discord.js v14
- AI: Groq SDK (llama-3.3-70b-versatile primary, llama-3.1-8b-instant for memory extraction)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/bot/` — all Discord bot code
  - `index.ts` — client setup, event registration, `startBot()`
  - `handlers.ts` — `messageCreate` handler, context building, AI call
  - `ai.ts` — Groq API wrapper, memory extraction
  - `memory.ts` — all DB operations (users, memories, history, config)
  - `commands.ts` — owner-only `!` prefix commands
- `lib/db/src/schema/discord.ts` — Discord tables (users, memories, messages, config)

## Bot Behaviour

**Responds when:**
- @mentioned in a server
- Sent a DM
- Someone replies to one of its messages

**Owner (aniq_alam, ID: 1186652407313219595) commands:**
- `!remember <fact>` — save a global memory
- `!rememberuser @user <fact>` — save a memory about a specific user
- `!forget <id>` — delete memory by ID
- `!memories` — list all stored memories
- `!usermemories @user` — list memories for a specific user
- `!clearctx` — wipe conversation history in the current channel
- `!botname <name>` — change the bot's name in prompts
- `!botpersonality <desc>` — add a personality note to the system prompt
- `!stats` — show memory count and uptime
- `!help` — show command list

**Memory system:**
- Last 20 messages per channel stored in PostgreSQL for conversation context
- Per-user and global persistent memories survive restarts
- Background memory extraction every 8 messages

**Anti-impersonation:**
- Owner verified by Discord User ID (1186652407313219595), not username or display name
- AI system prompt explicitly instructs the bot to reject impersonation claims
- Code-level check in commands handler

## Architecture decisions

- Discord bot runs inside the Express API server process — one workflow, one restart
- Groq rate limits mitigated by 2.5s per-user cooldown and using fast model for background tasks only
- Memory extraction is fire-and-forget — never blocks the response
- `PartialGroupDMChannel` excluded from `send()` via `isSendable()` type guard

## User preferences

- Owner: Aniq Alam, username aniq_alam, Discord User ID 1186652407313219595
- AI provider: Groq (llama-3.3-70b-versatile)
- Bot should be truly human-like — no corporate tone, no sycophantic openers
- No one should be able to impersonate the owner

## Gotchas

- After schema changes: run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs` before restarting
- Groq has rate limits — if the bot goes silent, check the workflow logs for 429 errors
- `bufferutil` and `utf-8-validate` are optional discord.js C++ addons — already externalized in build.mjs, safe to ignore the deprecation warnings

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
