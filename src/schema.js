import { z } from "zod";

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

// Channel and role fields accept either a Discord ID or a name ("general", "#welcome", "Moderators").
// The AI builder doesn't know a server's IDs, so it fills in names; the runtime resolves them.
const ref = z.string().describe("Channel or role name (e.g. 'welcome') or Discord ID. Empty string if unset.");

// The whole bot is one JSON document. The AI builder emits exactly this shape (structured outputs),
// the dashboard edits it, and the runtime reads it.
export const BotSpec = z.object({
  name: z.string().describe("Bot display name"),
  description: z.string().describe("One-sentence summary of what this bot does"),
  persona: z.object({
    systemPrompt: z.string().describe("Personality and instructions for the bot's AI brain, written in second person"),
    model: z.enum(MODELS),
    effort: z.enum(["low", "medium", "high"]).describe("How hard the AI thinks before replying. low suits casual chat"),
    statusText: z.string().describe("Short 'Playing ...' status shown under the bot's name"),
  }),
  aiChat: z.object({
    enabled: z.boolean(),
    replyToMentions: z.boolean(),
    replyInDMs: z.boolean(),
    channels: z.array(ref).describe("Channels where the bot replies to every message without being mentioned"),
    historyLength: z.number().int().describe("How many recent messages per channel the bot remembers (2-50)"),
    cooldownSeconds: z.number().int().describe("Per-user cooldown between AI replies (0-60)"),
    webSearch: z.boolean().describe("Let the AI search the web for current information (news, scores, prices, docs)"),
    vision: z.boolean().describe("Let the AI look at images members attach"),
  }),
  knowledge: z.object({
    enabled: z.boolean(),
    documents: z
      .array(z.object({ title: z.string(), content: z.string() }))
      .describe("Reference material the bot answers from: FAQs, rules, product info. Draft a starter FAQ only from facts in the description"),
  }),
  autoReplies: z.object({
    enabled: z.boolean(),
    rules: z.array(
      z.object({
        trigger: z.string(),
        match: z.enum(["contains", "exact", "startsWith", "regex"]),
        response: z.string().describe("Reply text. If useAI is true, this is an instruction for the AI instead"),
        useAI: z.boolean(),
      }),
    ),
  }),
  moderation: z.object({
    enabled: z.boolean(),
    bannedWords: z.array(z.string()),
    blockInvites: z.boolean(),
    blockLinks: z.boolean(),
    antiSpam: z.object({
      enabled: z.boolean(),
      maxMessages: z.number().int(),
      perSeconds: z.number().int(),
    }),
    aiModeration: z.boolean().describe("Use AI to catch harassment, hate speech and threats that word lists miss"),
    action: z.enum(["delete", "warn", "timeout"]),
    timeoutMinutes: z.number().int(),
    logChannel: ref,
  }),
  welcome: z.object({
    enabled: z.boolean(),
    channel: ref,
    message: z.string().describe("Supports {user}, {username}, {server}, {memberCount}"),
    useAI: z.boolean().describe("Let the AI write a fresh welcome for each member, in persona"),
    autoRole: ref,
  }),
  leveling: z.object({
    enabled: z.boolean(),
    xpMin: z.number().int(),
    xpMax: z.number().int(),
    cooldownSeconds: z.number().int(),
    announceChannel: ref.describe("Where level-ups are announced. Empty = same channel"),
    levelUpMessage: z.string().describe("Supports {user}, {level}"),
    roleRewards: z.array(z.object({ level: z.number().int(), role: ref })),
  }),
  tickets: z.object({
    enabled: z.boolean(),
    category: ref.describe("Category to create ticket channels in"),
    staffRole: ref,
    openMessage: z.string().describe("First message in a new ticket. Supports {user}"),
  }),
  giveaways: z.object({ enabled: z.boolean() }),
  selfRoles: z.object({
    enabled: z.boolean(),
    panels: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        roles: z.array(z.object({ role: ref, label: z.string(), emoji: z.string().describe("A single unicode emoji, or empty") })),
      }),
    ).describe("Button panels members click to give themselves roles. Admins post them with /selfroles"),
  }),
  reminders: z.object({ enabled: z.boolean() }),
  logging: z.object({
    enabled: z.boolean(),
    channel: ref,
    memberJoins: z.boolean(),
    memberLeaves: z.boolean(),
    messageDeletes: z.boolean(),
    messageEdits: z.boolean(),
  }),
  starboard: z.object({
    enabled: z.boolean(),
    channel: ref,
    emoji: z.string(),
    threshold: z.number().int().describe("Reactions needed to reach the starboard (1-50)"),
  }),
  economy: z.object({
    enabled: z.boolean(),
    currencyName: z.string(),
    currencyEmoji: z.string(),
    dailyAmount: z.number().int(),
    workMin: z.number().int(),
    workMax: z.number().int(),
  }),
  customCommands: z.array(
    z.object({
      name: z.string().describe("Slash command name: lowercase letters, digits, - or _, max 32 chars"),
      description: z.string(),
      type: z.enum(["text", "ai"]).describe("text = fixed reply; ai = response is a prompt the AI answers in persona"),
      response: z.string().describe("Supports {user}, {input}, {server}"),
      takesInput: z.boolean(),
      inputDescription: z.string(),
    }),
  ),
  limits: z.object({
    dailyAiReplies: z.number().int().describe("Max AI replies per day across all servers, to cap cost. 0 = unlimited"),
  }),
});

export const DEFAULT_SPEC = {
  name: "My Bot",
  description: "A friendly AI assistant for your server.",
  persona: {
    systemPrompt: "You are a friendly, helpful member of this Discord server. Keep replies short and conversational.",
    model: "claude-opus-5-5",
    effort: "low",
    statusText: "Chatting with the server",
  },
  aiChat: {
    enabled: true,
    replyToMentions: true,
    replyInDMs: true,
    channels: [],
    historyLength: 20,
    cooldownSeconds: 3,
    webSearch: false,
    vision: true,
  },
  knowledge: { enabled: false, documents: [] },
  autoReplies: { enabled: false, rules: [] },
  moderation: {
    enabled: false,
    bannedWords: [],
    blockInvites: false,
    blockLinks: false,
    antiSpam: { enabled: false, maxMessages: 5, perSeconds: 5 },
    aiModeration: false,
    action: "delete",
    timeoutMinutes: 10,
    logChannel: "",
  },
  welcome: { enabled: false, channel: "", message: "Welcome to {server}, {user}! 🎉", useAI: false, autoRole: "" },
  leveling: {
    enabled: false,
    xpMin: 15,
    xpMax: 25,
    cooldownSeconds: 60,
    announceChannel: "",
    levelUpMessage: "GG {user}, you reached level {level}!",
    roleRewards: [],
  },
  tickets: { enabled: false, category: "", staffRole: "", openMessage: "Hi {user}, thanks for reaching out. Staff will be with you shortly." },
  giveaways: { enabled: false },
  selfRoles: { enabled: false, panels: [] },
  reminders: { enabled: false },
  logging: { enabled: false, channel: "", memberJoins: true, memberLeaves: true, messageDeletes: true, messageEdits: true },
  starboard: { enabled: false, channel: "starboard", emoji: "⭐", threshold: 3 },
  economy: { enabled: false, currencyName: "coins", currencyEmoji: "🪙", dailyAmount: 100, workMin: 20, workMax: 80 },
  customCommands: [],
  limits: { dailyAiReplies: 500 },
};

export const KNOWLEDGE_LIMIT = 200_000; // characters across all documents

const clamp = (n, lo, hi, fallback) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback);

// Missing keys take the default; present keys of the wrong type pass through so validation rejects them.
// Unknown keys are dropped.
function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (base && typeof base === "object" && !Array.isArray(base) && over && typeof over === "object" && !Array.isArray(over)) {
    const out = { ...base };
    for (const k of Object.keys(base)) if (k in over) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over;
}

export const RESERVED_COMMANDS = new Set([
  "ask", "reset", "help", "rank", "leaderboard", "ticket", "giveaway", "balance", "daily", "work", "pay",
  "richest", "warn", "warnings", "purge", "timeout", "selfroles", "remind", "reminders",
]);

export function slugCommand(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

// Fill gaps from defaults, validate types, then clamp numbers into ranges Discord and the runtime accept.
export function normalizeSpec(input) {
  const spec = BotSpec.parse(deepMerge(DEFAULT_SPEC, input ?? {}));
  const d = DEFAULT_SPEC;

  spec.name = spec.name.trim().slice(0, 80) || d.name;
  spec.persona.statusText = spec.persona.statusText.slice(0, 128);
  spec.aiChat.historyLength = clamp(spec.aiChat.historyLength, 2, 50, d.aiChat.historyLength);
  spec.aiChat.cooldownSeconds = clamp(spec.aiChat.cooldownSeconds, 0, 60, d.aiChat.cooldownSeconds);
  spec.moderation.antiSpam.maxMessages = clamp(spec.moderation.antiSpam.maxMessages, 2, 50, 5);
  spec.moderation.antiSpam.perSeconds = clamp(spec.moderation.antiSpam.perSeconds, 1, 60, 5);
  spec.moderation.timeoutMinutes = clamp(spec.moderation.timeoutMinutes, 1, 40320, 10);
  spec.moderation.bannedWords = spec.moderation.bannedWords.map((w) => w.trim()).filter(Boolean);
  spec.leveling.xpMin = clamp(spec.leveling.xpMin, 1, 1000, d.leveling.xpMin);
  spec.leveling.xpMax = clamp(spec.leveling.xpMax, spec.leveling.xpMin, 1000, Math.max(spec.leveling.xpMin, d.leveling.xpMax));
  spec.leveling.cooldownSeconds = clamp(spec.leveling.cooldownSeconds, 0, 3600, d.leveling.cooldownSeconds);
  spec.leveling.roleRewards = spec.leveling.roleRewards
    .map((r) => ({ level: clamp(r.level, 1, 1000, 1), role: r.role.trim() }))
    .filter((r) => r.role);
  spec.economy.dailyAmount = clamp(spec.economy.dailyAmount, 0, 1e9, d.economy.dailyAmount);
  spec.economy.workMin = clamp(spec.economy.workMin, 0, 1e9, d.economy.workMin);
  spec.economy.workMax = clamp(spec.economy.workMax, spec.economy.workMin, 1e9, Math.max(spec.economy.workMin, d.economy.workMax));
  spec.autoReplies.rules = spec.autoReplies.rules
    .filter((r) => r.trigger && r.response)
    .map((r) => ({ ...r, trigger: r.trigger.slice(0, 200) }));

  spec.starboard.threshold = clamp(spec.starboard.threshold, 1, 50, 3);
  spec.starboard.emoji = spec.starboard.emoji.trim() || "⭐";
  spec.limits.dailyAiReplies = clamp(spec.limits.dailyAiReplies, 0, 1e6, d.limits.dailyAiReplies);

  let budget = KNOWLEDGE_LIMIT;
  spec.knowledge.documents = spec.knowledge.documents
    .filter((doc) => doc.content.trim())
    .map((doc) => {
      const content = doc.content.slice(0, Math.max(0, budget));
      budget -= content.length;
      return { title: doc.title.trim().slice(0, 120) || "Untitled", content };
    })
    .filter((doc) => doc.content);

  // Discord allows 5 rows of 5 buttons per message.
  spec.selfRoles.panels = spec.selfRoles.panels
    .map((p) => ({
      title: p.title.slice(0, 256) || "Pick your roles",
      description: p.description.slice(0, 2000),
      roles: p.roles.filter((r) => r.role.trim()).slice(0, 25).map((r) => ({ role: r.role.trim(), label: (r.label || r.role).slice(0, 80), emoji: r.emoji.trim() })),
    }))
    .filter((p) => p.roles.length)
    .slice(0, 10);

  // Discord rejects duplicate or malformed command names, so fix them here rather than at login.
  const seen = new Set(RESERVED_COMMANDS);
  spec.customCommands = spec.customCommands
    .map((c) => ({
      ...c,
      name: slugCommand(c.name),
      description: (c.description || "Custom command").slice(0, 100),
      inputDescription: (c.inputDescription || "Your input").slice(0, 100),
    }))
    .filter((c) => c.name && c.response && !seen.has(c.name) && seen.add(c.name))
    .slice(0, 50);

  return spec;
}
