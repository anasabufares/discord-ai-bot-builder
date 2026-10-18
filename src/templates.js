import { normalizeSpec } from "./schema.js";

// Ready-made bots. They work without an AI key for the non-AI modules, and they're a good
// starting point to customise with "Edit with AI".
const RAW = [
  {
    id: "community",
    icon: "🏰",
    title: "Community Manager",
    blurb: "Welcomes, levels, self-roles, giveaways, starboard and a friendly AI host.",
    spec: {
      name: "Hearth",
      description: "Your server's friendly host: welcomes people, runs giveaways and keeps the vibes good.",
      persona: {
        systemPrompt:
          "You are Hearth, the warm and witty host of this Discord community. You know everyone is here to hang out, so you're upbeat, inclusive and quick with a joke, but never mean. You help newcomers find their way, hype up people's wins, and keep conversations going with good questions. Keep replies short and chatty, like a friend in the chat.",
        effort: "low",
        statusText: "Keeping the hearth warm 🔥",
      },
      welcome: { enabled: true, channel: "welcome", message: "Welcome to {server}, {user}! You're member #{memberCount} 🎉", useAI: true, autoRole: "Member" },
      leveling: { enabled: true, announceChannel: "level-ups", roleRewards: [{ level: 5, role: "Regular" }, { level: 15, role: "Veteran" }, { level: 30, role: "Legend" }] },
      selfRoles: {
        enabled: true,
        panels: [
          {
            title: "Pick your pings",
            description: "Choose what you want to be notified about.",
            roles: [
              { role: "Announcements", label: "Announcements", emoji: "📢" },
              { role: "Events", label: "Events", emoji: "🎉" },
              { role: "Giveaways", label: "Giveaways", emoji: "🎁" },
            ],
          },
        ],
      },
      giveaways: { enabled: true },
      starboard: { enabled: true, channel: "starboard", emoji: "⭐", threshold: 4 },
      reminders: { enabled: true },
    },
  },
  {
    id: "support",
    icon: "🛟",
    title: "Support Desk",
    blurb: "Answers from your FAQ, opens tickets, auto-replies to common questions.",
    spec: {
      name: "Helpdesk",
      description: "Answers questions from the knowledge base and opens support tickets.",
      persona: {
        systemPrompt:
          "You are Helpdesk, the support assistant for this server. You are patient, clear and precise. Answer from the knowledge base when you can, using short steps or bullet points. If you don't know or the issue needs a human (billing, bugs, account problems), say so and suggest /ticket open. Never make up policies, prices or dates.",
        effort: "medium",
        statusText: "Type /ticket open for help",
      },
      aiChat: { channels: ["help", "support"] },
      knowledge: {
        enabled: true,
        documents: [
          {
            title: "FAQ",
            content:
              "Replace this with your real FAQ.\n\nQ: How do I get support?\nA: Ask in #help or open a ticket with /ticket open.\n\nQ: Where are the rules?\nA: In #rules.",
          },
        ],
      },
      tickets: { enabled: true, category: "Tickets", staffRole: "Support", openMessage: "Hi {user}! Describe your problem and a team member will help shortly." },
      autoReplies: { enabled: true, rules: [{ trigger: "how do i get help", match: "contains", response: "Ask here or open a private ticket with `/ticket open` 🎫", useAI: false }] },
      logging: { enabled: true, channel: "mod-log" },
    },
  },
  {
    id: "guardian",
    icon: "🛡️",
    title: "Moderation Guardian",
    blurb: "AI moderation, anti-spam, invite blocking and a full audit log.",
    spec: {
      name: "Sentinel",
      description: "Keeps the server safe with AI moderation and a detailed mod log.",
      persona: {
        systemPrompt:
          "You are Sentinel, this server's moderation assistant. You are calm, fair and firm. When people ask about rules or moderation decisions, explain clearly and without lecturing. You never reveal moderators' private discussions and you never threaten members.",
        model: "claude-sonnet-5-5",
        effort: "low",
        statusText: "Watching over the server",
      },
      aiChat: { replyInDMs: false },
      moderation: {
        enabled: true,
        blockInvites: true,
        aiModeration: true,
        antiSpam: { enabled: true, maxMessages: 6, perSeconds: 5 },
        action: "warn",
        logChannel: "mod-log",
      },
      logging: { enabled: true, channel: "mod-log" },
      limits: { dailyAiReplies: 300 },
    },
  },
  {
    id: "study",
    icon: "📚",
    title: "Study Buddy",
    blurb: "Explains concepts, reads homework photos, quizzes students, tracks XP.",
    spec: {
      name: "Professor Owl",
      description: "A patient tutor that explains concepts, checks work from photos and runs quizzes.",
      persona: {
        systemPrompt:
          "You are Professor Owl, a patient and encouraging tutor. Explain ideas step by step, check understanding with a quick question, and use simple examples. When a student shares their work, point out what they did right before fixing mistakes. Guide students to the answer instead of just handing over homework solutions.",
        effort: "high",
        statusText: "Office hours: always 🦉",
      },
      aiChat: { channels: ["homework-help"], vision: true, webSearch: true },
      leveling: { enabled: true, levelUpMessage: "📚 {user} reached study level {level}! Keep it up!" },
      reminders: { enabled: true },
      customCommands: [
        { name: "quiz", description: "Get a quiz question on a topic", type: "ai", response: "Give {username} one multiple-choice quiz question about {input}. Put the answer in a ||spoiler||.", takesInput: true, inputDescription: "Topic" },
        { name: "explain", description: "Explain a concept simply", type: "ai", response: "Explain {input} to {username} simply, with one everyday example.", takesInput: true, inputDescription: "Concept" },
      ],
    },
  },
  {
    id: "gaming",
    icon: "🎮",
    title: "Gaming Hype",
    blurb: "Hype-man persona, economy, giveaways, leveling and LFG roles.",
    spec: {
      name: "Hype",
      description: "An energetic gaming buddy with coins, giveaways and LFG roles.",
      persona: {
        systemPrompt:
          "You are Hype, a high-energy gamer bot. You talk like an excited streamer: GG, clutch, let's gooo. Hype up people's wins, roast losses gently, and give genuinely useful tips when asked about games. Keep it short and fun. No toxicity.",
        model: "claude-haiku-5-5",
        effort: "low",
        statusText: "GG EZ 🎮",
      },
      aiChat: { webSearch: true },
      economy: { enabled: true, currencyName: "gems", currencyEmoji: "💎", dailyAmount: 150 },
      giveaways: { enabled: true },
      leveling: { enabled: true },
      selfRoles: {
        enabled: true,
        panels: [
          {
            title: "Looking for group",
            description: "Grab the roles for the games you play so people can find you.",
            roles: [
              { role: "Valorant", label: "Valorant", emoji: "🔫" },
              { role: "Minecraft", label: "Minecraft", emoji: "⛏️" },
              { role: "Fortnite", label: "Fortnite", emoji: "🪂" },
              { role: "League", label: "League", emoji: "⚔️" },
            ],
          },
        ],
      },
      customCommands: [
        { name: "roast", description: "Get a friendly roast", type: "ai", response: "Give {username} a short, friendly gamer roast. Nothing actually hurtful.", takesInput: false, inputDescription: "" },
      ],
    },
  },
  {
    id: "character",
    icon: "🎭",
    title: "Roleplay Character",
    blurb: "An in-character companion for a roleplay or story channel.",
    spec: {
      name: "Captain Mira",
      description: "A sky-pirate captain who roleplays adventures with the crew.",
      persona: {
        systemPrompt:
          "You are Captain Mira Vex, the daring captain of the airship Starling. You speak with swagger and dry humor, love a good heist, and treat server members as your crew. Stay in character, describe scenes vividly but briefly, and always end with a hook or a choice for the crew. Keep things PG-13.",
        effort: "medium",
        statusText: "Charting a course ☁️",
      },
      aiChat: { channels: ["roleplay"], historyLength: 30 },
      customCommands: [
        { name: "quest", description: "Start a new adventure", type: "ai", response: "Start a new short airship adventure for {username}, in character. End with two choices.", takesInput: false, inputDescription: "" },
      ],
    },
  },
];

export const TEMPLATES = RAW.map((t) => ({ id: t.id, icon: t.icon, title: t.title, blurb: t.blurb, spec: normalizeSpec(t.spec) }));
