import { ActivityType, Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, Partials, SlashCommandBuilder } from "discord.js";
import { LimitError } from "../ai.js";
import { dayStats, recordUsage } from "../store.js";
import { createAiChat } from "./modules/ai-chat.js";
import { createAutoReplies } from "./modules/auto-replies.js";
import { createCustomCommands } from "./modules/custom-commands.js";
import { createEconomy } from "./modules/economy.js";
import { createGiveaways } from "./modules/giveaways.js";
import { createLeveling } from "./modules/leveling.js";
import { createModeration } from "./modules/moderation.js";
import { createTickets } from "./modules/tickets.js";
import { createWelcome } from "./modules/welcome.js";
import { createLogging } from "./modules/logging.js";
import { createReminders } from "./modules/reminders.js";
import { createSelfRoles } from "./modules/self-roles.js";
import { createStarboard } from "./modules/starboard.js";


// Ask Discord only for the gateway intents the enabled modules need.
// MessageContent and GuildMembers are "privileged": they must also be switched on in the Developer Portal.
export function intentsFor(spec) {
  const intents = [GatewayIntentBits.Guilds];
  const log = spec.logging;
  const readsMessages =
    spec.aiChat.enabled || spec.autoReplies.enabled || spec.moderation.enabled || spec.leveling.enabled || spec.starboard.enabled ||
    (log.enabled && (log.messageDeletes || log.messageEdits));
  if (readsMessages) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  if (spec.aiChat.enabled && spec.aiChat.replyInDMs) intents.push(GatewayIntentBits.DirectMessages);
  if (spec.welcome.enabled || (log.enabled && (log.memberJoins || log.memberLeaves))) intents.push(GatewayIntentBits.GuildMembers);
  if (spec.starboard.enabled) intents.push(GatewayIntentBits.GuildMessageReactions);
  return intents;
}

const FRIENDLY_ERRORS = {
  TokenInvalid: "Discord rejected the bot token. Copy a fresh one from the Developer Portal → Bot → Reset Token.",
  DisallowedIntents:
    "Discord refused the connection: turn on MESSAGE CONTENT INTENT (and SERVER MEMBERS INTENT if the welcome module is on) in the Developer Portal → Bot → Privileged Gateway Intents.",
};

export class BotRuntime {
  constructor({ id, spec, token, ai, state, log, onStatus }) {
    Object.assign(this, { id, spec, token, state, log, onStatus });
    this.client = null;

    // Every AI call goes through here so usage is counted and the daily cap is enforced.
    const onUsage = (model, usage, cost) => this.recordUsage(usage, cost);
    this.ai = {
      chat: (spec, messages, opts = {}) => {
        const limit = this.spec.limits.dailyAiReplies;
        if (limit && this.stats().aiReplies >= limit) {
          throw new ai.LimitError("I've reached my daily limit for AI replies. Try again tomorrow!");
        }
        this.bump("aiReplies");
        return ai.chat(spec, messages, { ...opts, onUsage });
      },
      moderate: (text) => ai.moderate(text, { onUsage }),
    };

    this.aiChat = createAiChat(this);
    // Order matters for messages: moderation first (it can delete), leveling never consumes,
    // auto-replies beat AI chat so fixed answers win.
    this.modules = [
      createModeration(this),
      createLeveling(this),
      createAutoReplies(this),
      this.aiChat,
      createWelcome(this),
      createLogging(this),
      createStarboard(this),
      createTickets(this),
      createGiveaways(this),
      createEconomy(this),
      createSelfRoles(this),
      createReminders(this),
      createCustomCommands(this),
    ];
  }

  stats() {
    return dayStats(this.state);
  }

  bump(key, n = 1) {
    this.stats()[key] += n;
    this.state.save();
  }

  recordUsage(usage, cost) {
    recordUsage(this.state, usage, cost);
  }

  // Push the dashboard's name and avatar to the Discord bot user. Discord rate-limits these heavily.
  async syncProfile({ username, avatarUrl }) {
    const user = this.client?.user;
    if (!user) throw new Error("Start the bot first.");
    if (username && username !== user.username) await user.setUsername(username.slice(0, 32));
    if (avatarUrl) await user.setAvatar(avatarUrl);
    this.onStatus("online", { tag: user.tag, avatar: user.displayAvatarURL() });
  }

  commandsJson() {
    const commands = this.modules.flatMap((m) => m.commands());
    commands.push(new SlashCommandBuilder().setName("help").setDescription(`What can ${this.spec.name} do?`));
    return commands.map((c) => c.toJSON());
  }

  async registerCommands(guild) {
    try {
      await guild.commands.set(this.commandsJson());
    } catch (e) {
      this.log(`Couldn't register slash commands in "${guild.name}": ${e.message}`);
    }
  }

  setPresence() {
    this.client?.user?.setActivity(this.spec.persona.statusText || this.spec.description, { type: ActivityType.Custom });
  }

  async start() {
    this.onStatus("starting");
    const client = new Client({
      intents: intentsFor(this.spec),
      partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember],
    });
    this.client = client;

    client.once(Events.ClientReady, async () => {
      this.log(`Online as ${client.user.tag} in ${client.guilds.cache.size} server(s)`);
      this.setPresence();
      await Promise.all(client.guilds.cache.map((g) => this.registerCommands(g)));
      for (const m of this.modules) m.onReady?.();
      this.onStatus("online", { tag: client.user.tag, avatar: client.user.displayAvatarURL(), guilds: client.guilds.cache.size });
    });

    client.on(Events.GuildCreate, (guild) => {
      this.log(`Joined server "${guild.name}"`);
      this.registerCommands(guild);
      this.onStatus("online", { guilds: client.guilds.cache.size });
    });
    client.on(Events.GuildDelete, () => this.onStatus("online", { guilds: client.guilds.cache.size }));

    client.on(Events.MessageCreate, (message) => this.handleMessage(message));
    client.on(Events.InteractionCreate, (interaction) => this.handleInteraction(interaction));
    const fanOut = (hook, label) => (...args) => {
      for (const m of this.modules) m[hook]?.(...args)?.catch?.((e) => this.log(`${label} error: ${e.message}`));
    };
    client.on(Events.GuildMemberAdd, (member) => {
      this.bump("joins");
      fanOut("onMemberAdd", "Member join")(member);
    });
    client.on(Events.GuildMemberRemove, fanOut("onMemberRemove", "Member leave"));
    client.on(Events.MessageDelete, fanOut("onMessageDelete", "Message delete"));
    client.on(Events.MessageUpdate, fanOut("onMessageUpdate", "Message edit"));
    client.on(Events.MessageReactionAdd, fanOut("onReaction", "Reaction"));
    client.on(Events.MessageReactionRemove, fanOut("onReaction", "Reaction"));
    client.on(Events.Error, (e) => this.log(`Discord error: ${e.message}`));
    client.on(Events.ShardDisconnect, (event) => {
      if (event.code === 4014) this.fail(FRIENDLY_ERRORS.DisallowedIntents);
    });

    try {
      await client.login(this.token);
    } catch (e) {
      const friendly = e.code === "TokenInvalid" ? FRIENDLY_ERRORS.TokenInvalid : /disallowed intents/i.test(e.message) ? FRIENDLY_ERRORS.DisallowedIntents : e.message;
      this.fail(friendly);
      throw new Error(friendly);
    }
  }

  fail(message) {
    this.log(`Error: ${message}`);
    this.onStatus("error", { error: message });
    this.stop().catch(() => {});
  }

  async stop() {
    for (const m of this.modules) m.stop?.();
    const client = this.client;
    this.client = null;
    await client?.destroy();
  }

  // Apply a new spec without reconnecting (the manager restarts instead when intents change).
  async update(spec) {
    this.spec = spec;
    this.aiChat.clear();
    if (!this.client?.isReady()) return;
    this.setPresence();
    await Promise.all(this.client.guilds.cache.map((g) => this.registerCommands(g)));
    this.log("Configuration updated");
  }

  async handleMessage(message) {
    if (message.author.bot || message.system || message.partial) return;
    this.bump("messages");
    try {
      for (const m of this.modules) {
        if (m.onMessage && (await m.onMessage(message))) return;
      }
    } catch (e) {
      const limited = e instanceof LimitError;
      if (!limited) this.log(`Error handling message: ${e.message}`);
      const content = limited ? e.message : "Something went wrong on my end. Try again in a moment.";
      await message.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
    }
  }

  async handleInteraction(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        this.log(`/${interaction.commandName} by ${interaction.user.tag}`);
        this.bump("commands");
        if (interaction.commandName === "help") return await this.help(interaction);
        for (const m of this.modules) {
          if (m.onCommand && (await m.onCommand(interaction))) return;
        }
        await interaction.reply({ content: "That command is no longer enabled.", flags: MessageFlags.Ephemeral });
      } else if (interaction.isButton()) {
        for (const m of this.modules) {
          if (m.onButton && (await m.onButton(interaction))) return;
        }
      }
    } catch (e) {
      const limited = e instanceof LimitError;
      if (!limited) this.log(`Error in /${interaction.commandName ?? interaction.customId}: ${e.message}`);
      const reply = { content: limited ? e.message : "Something went wrong running that. Try again in a moment.", flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  }

  async help(interaction) {
    const lines = this.commandsJson()
      .filter((c) => c.name !== "help")
      .map((c) => `\`/${c.name}\` — ${c.description}`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(this.spec.name)
      .setDescription(`${this.spec.description}\n\n${lines.join("\n")}${this.spec.aiChat.enabled ? "\n\nYou can also @mention me to chat." : ""}`);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
