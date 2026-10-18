// Runs a single exported bot without the dashboard:
//   1. put DISCORD_TOKEN and ANTHROPIC_API_KEY in .env
//   2. npm install && npm start
// Edit bot.json to change the bot, then restart.
import fs from "node:fs";
import path from "node:path";
import * as ai from "./ai.js";
import { BotRuntime } from "./runtime/bot.js";
import { normalizeSpec } from "./schema.js";
import { Store } from "./store.js";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Set DISCORD_TOKEN in .env (Developer Portal → your app → Bot → Reset Token).");
  process.exit(1);
}

const file = JSON.parse(fs.readFileSync(process.argv[2] ?? "bot.json", "utf8"));
const spec = normalizeSpec(file.spec ?? file);
const store = new Store(path.resolve(process.env.DATA_DIR || "./data"));
const id = "00000000-0000-4000-8000-000000000000";

const bot = new BotRuntime({
  id,
  spec,
  token,
  ai,
  state: store.state(id),
  log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
  onStatus: (state, extra) => state === "error" && console.error(extra?.error),
});

bot.start().catch(() => process.exit(1));

async function shutdown() {
  await bot.stop();
  store.flushAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
