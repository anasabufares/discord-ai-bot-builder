import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ZodError } from "zod";
import { aiConfigured, chat, generateSpec } from "./ai.js";
import { config } from "./config.js";
import { createCipher, createSessions, safeEqual } from "./crypto.js";
import { BotManager, clientIdFromToken, inviteUrl } from "./manager.js";
import { DEFAULT_SPEC, MODELS, normalizeSpec } from "./schema.js";
import { Store, dayStats, recordUsage, today } from "./store.js";
import { TEMPLATES } from "./templates.js";
import { createZip } from "./zip.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(config.dataDir);
const cipher = createCipher(config.secretKey);
const sessions = createSessions(config.secretKey);
const manager = new BotManager(store, cipher);
const app = express();

app.disable("x-powered-by");
// Behind a local reverse proxy (Caddy/nginx), use the client IP it forwards for login rate limiting.
app.set("trust proxy", "loopback");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "..", "public")));

// ---- auth ---------------------------------------------------------------

const COOKIE = "session";
function readCookie(req) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

const failures = new Map(); // ip -> { count, until }
function loginLimited(ip) {
  const f = failures.get(ip);
  return f && f.count >= 5 && f.until > Date.now();
}
function noteFailure(ip) {
  const f = failures.get(ip);
  const fresh = !f || f.until < Date.now();
  failures.set(ip, { count: fresh ? 1 : f.count + 1, until: Date.now() + 15 * 60_000 });
}

app.post("/api/login", (req, res) => {
  if (loginLimited(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  if (!safeEqual(req.body?.password ?? "", config.adminPassword)) {
    noteFailure(req.ip);
    return res.status(401).json({ error: "Wrong password." });
  }
  failures.delete(req.ip);
  const flags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessions.ttlMs / 1000}${config.secureCookies ? "; Secure" : ""}`;
  res.set("Set-Cookie", `${COOKIE}=${sessions.issue()}; ${flags}`).json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.set("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`).json({ ok: true });
});

app.use("/api", (req, res, next) => {
  if (!sessions.verify(readCookie(req))) return res.status(401).json({ error: "Please sign in." });
  // Mutations must be JSON: browsers can't send that cross-site without a CORS preflight we never allow.
  if (req.method !== "GET" && !req.is("application/json")) return res.status(415).json({ error: "Expected JSON." });
  next();
});

// ---- bots ---------------------------------------------------------------

function view(record) {
  const clientId = record.clientId ?? null;
  return {
    id: record.id,
    spec: record.spec,
    hasToken: Boolean(record.token),
    clientId,
    inviteUrl: inviteUrl(clientId),
    running: Boolean(record.running),
    status: manager.getStatus(record.id),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function findBot(req, res) {
  const record = store.getBot(req.params.id);
  if (!record) res.status(404).json({ error: "Bot not found." });
  return record;
}

function applyToken(record, token) {
  if (token === undefined || token === null || token === "") return false;
  const trimmed = String(token).trim();
  const clientId = clientIdFromToken(trimmed);
  if (!clientId) throw Object.assign(new Error("That doesn't look like a Discord bot token."), { status: 400 });
  record.token = cipher.encrypt(trimmed);
  record.clientId = clientId;
  return true;
}

app.get("/api/meta", (req, res) => res.json({ aiConfigured: aiConfigured(), models: MODELS, defaults: DEFAULT_SPEC, templates: TEMPLATES }));

app.get("/api/bots", (req, res) => res.json(store.listBots().map(view)));

app.get("/api/bots/:id", (req, res) => {
  const record = findBot(req, res);
  if (record) res.json(view(record));
});

// Plain English -> configuration. Doesn't save anything; the dashboard shows a preview first.
app.post("/api/generate", async (req, res) => {
  const description = String(req.body?.description ?? "").trim();
  if (description.length < 5) return res.status(400).json({ error: "Describe your bot in a sentence or two." });
  if (description.length > 4000) return res.status(400).json({ error: "Keep the description under 4000 characters." });
  const current = req.body?.current ? normalizeSpec(req.body.current) : null;
  res.json({ spec: await generateSpec(description, current) });
});

app.post("/api/bots", (req, res) => {
  const now = new Date().toISOString();
  const record = { id: crypto.randomUUID(), spec: normalizeSpec(req.body?.spec), running: false, createdAt: now, updatedAt: now };
  applyToken(record, req.body?.token);
  store.putBot(record);
  res.status(201).json(view(record));
});

app.put("/api/bots/:id", async (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const previousSpec = record.spec;
  if (req.body?.spec) record.spec = normalizeSpec(req.body.spec);
  const tokenChanged = applyToken(record, req.body?.token);
  record.updatedAt = new Date().toISOString();
  store.putBot(record);
  await manager.applyUpdate(record.id, { tokenChanged, previousSpec }).catch((e) => manager.log(record.id, `Update failed: ${e.message}`));
  res.json(view(record));
});

app.post("/api/bots/:id/duplicate", (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const now = new Date().toISOString();
  const copy = { id: crypto.randomUUID(), spec: { ...structuredClone(record.spec), name: `${record.spec.name} (copy)`.slice(0, 80) }, running: false, createdAt: now, updatedAt: now };
  store.putBot(copy);
  res.status(201).json(view(copy));
});

app.delete("/api/bots/:id", async (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  await manager.stop(record.id);
  store.deleteBot(record.id);
  res.json({ ok: true });
});

app.post("/api/bots/:id/start", async (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  await manager.start(record.id);
  res.json(view(store.getBot(record.id)));
});

app.post("/api/bots/:id/stop", async (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  await manager.stop(record.id);
  res.json(view(store.getBot(record.id)));
});

app.get("/api/bots/:id/logs", (req, res) => {
  if (findBot(req, res)) res.json(manager.getLogs(req.params.id));
});

// Last 30 days of activity and AI spend.
app.get("/api/bots/:id/stats", (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const file = store.state(record.id);
  dayStats(file); // make sure today exists
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({ day, ...(file.data.stats?.[day] ?? { messages: 0, aiReplies: 0, commands: 0, joins: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 }) });
  }
  res.json({ today: today(), days, dailyLimit: record.spec.limits.dailyAiReplies });
});

// Push the bot's name and avatar to its Discord account.
app.post("/api/bots/:id/sync-profile", async (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const avatarUrl = String(req.body?.avatarUrl ?? "").trim();
  if (avatarUrl && !/^https:\/\/\S+$/i.test(avatarUrl)) return res.status(400).json({ error: "The avatar must be an https:// image URL." });
  await manager.syncProfile(record.id, { username: record.spec.name, avatarUrl: avatarUrl || null });
  res.json(view(record));
});

// Playground: talk to the bot's persona (optionally with unsaved edits) without Discord.
app.post("/api/bots/:id/test", async (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const spec = req.body?.spec ? normalizeSpec(req.body.spec) : record.spec;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-50) : [];
  const valid = messages.every((m) => ["user", "assistant"].includes(m?.role) && typeof m.content === "string" && m.content.length <= 4000);
  if (!messages.length || !valid || messages.at(-1).role !== "user") return res.status(400).json({ error: "Invalid conversation." });
  while (messages.length && messages[0].role !== "user") messages.shift();
  const reply = await chat(
    spec,
    messages.map((m) => ({ role: m.role, content: m.role === "user" ? `You: ${m.content}` : m.content })),
    { onUsage: (model, usage, cost) => recordUsage(store.state(record.id), usage, cost) },
  );
  res.json({ reply });
});

// Export a bot's configuration (never its token) to back it up or move it.
app.get("/api/bots/:id/export", (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const filename = `${record.spec.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "bot"}.json`;
  res.set("Content-Disposition", `attachment; filename="${filename}"`).json({ format: "discord-ai-bot-builder/v1", spec: record.spec });
});

// "You own the code": a ready-to-run project containing just this bot and the runtime.
const ROOT = path.join(here, "..");
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name).split(path.sep).join("/")],
  );
}

app.get("/api/bots/:id/export-code", (req, res) => {
  const record = findBot(req, res);
  if (!record) return;
  const slug = record.spec.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "bot";
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const { express, ...deps } = pkg.dependencies;
  const sources = ["src/ai.js", "src/schema.js", "src/store.js", "src/standalone.js", ...walk("src/runtime")];
  const files = [
    ...sources.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) })),
    { name: "bot.json", data: JSON.stringify({ format: "discord-ai-bot-builder/v1", spec: record.spec }, null, 2) },
    {
      name: "package.json",
      data: JSON.stringify({ name: slug, version: "1.0.0", private: true, type: "module", engines: pkg.engines, scripts: { start: "node src/standalone.js" }, dependencies: deps }, null, 2),
    },
    { name: ".env.example", data: "DISCORD_TOKEN=\nANTHROPIC_API_KEY=sk-ant-...\nDATA_DIR=./data\n" },
    { name: ".gitignore", data: "node_modules/\ndata/\n.env\n" },
    {
      name: "Dockerfile",
      data: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --omit=dev\nCOPY . .\nRUN mkdir -p /data && chown node:node /data\nENV DATA_DIR=/data\nVOLUME /data\nUSER node\nCMD ["node", "src/standalone.js"]\n',
    },
    {
      name: "README.md",
      data: `# ${record.spec.name}\n\n${record.spec.description}\n\nExported from Botsmith. This folder is a complete Discord bot that you own.\n\n## Run it\n\n\`\`\`bash\nnpm install\ncp .env.example .env   # set DISCORD_TOKEN and ANTHROPIC_API_KEY\nnpm start\n\`\`\`\n\nIn the Discord Developer Portal → Bot, turn on Message Content Intent (and Server Members Intent if Welcome or member logging is on).\n\n## Change it\n\nEdit \`bot.json\` and restart. It's the same format the Botsmith dashboard imports and exports. The behaviour lives in \`src/runtime/\`.\n`,
    },
  ];
  res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug}.zip"` }).send(createZip(files.map((f) => ({ ...f, name: `${slug}/${f.name}` }))));
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.get("/{*any}", (req, res) => res.sendFile(path.join(here, "..", "public", "index.html")));

app.use((err, req, res, next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: `Invalid configuration: ${err.issues[0]?.path.join(".")} ${err.issues[0]?.message}` });
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Server error" });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Dashboard: http://${config.host}:${config.port}`);
  if (!aiConfigured()) console.warn("ANTHROPIC_API_KEY is not set: the AI builder and AI replies won't work until it is.");
  manager.startAll();
});

async function shutdown() {
  console.log("Shutting down…");
  server.close();
  await manager.stopAll();
  store.flushAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
