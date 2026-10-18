import { ActivityType, Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, Partials, SlashCommandBuilder } from "discord.js";
import { createAiChat } from "./modules/ai-chat.js";
import { createAutoReplies } from "./modules/auto-replies.js";
import { createCustomCommands } from "./modules/custom-commands.js";
import { createEconomy } from "./modules/economy.js";
import { createGiveaways } from "./modules/giveaways.js";
import { createLeveling } from "./modules/leveling.js";
import { createModeration } from "./modules/moderation.js";
import { createTickets } from "./modules/tickets.js";
import { createWelcome } from "./modules/welcome.js";

// Ask Discord only for the gateway intents the enabled modules need.
// MessageContent and GuildMembers are "privileged": they must also be switched on in the Developer Portal.
export function intentsFor(spec) {
  const intents = [GatewayIntentBits.Guilds];
  const readsMessages = spec.aiChat.enabled || spec.autoReplies.enabled || spec.moderation.enabled || spec.leveling.enabled;
  if (readsMessages) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  if (spec.aiChat.enabled && spec.aiChat.replyInDMs) intents.push(GatewayIntentBits.DirectMessages);
  if (spec.welcome.enabled) intents.push(GatewayIntentBits.GuildMembers);
  return intents;
}

const FRIENDLY_ERRORS = {
  TokenInvalid: "Discord rejected the bot token. Copy a fresh one from the Developer Portal → Bot → Reset Token.",
  DisallowedIntents:
    "Discord refused the connection: turn on MESSAGE CONTENT INTENT (and SERVER MEMBERS INTENT if the welcome module is on) in the Developer Portal → Bot → Privileged Gateway Intents.",
};

export class BotRuntime {
  constructor({ id, spec, token, ai, state, log, onStatus }) {
    Object.assign(this, { id, spec, token, ai, state, log, onStatus });
    this.client = null;

    this.aiChat = createAiChat(this);
    // Order matters for messages: moderation first (it can delete), leveling never consumes,
    // auto-replies beat AI chat so fixed answers win.
    this.modules = [
      createModeration(this),
      createLeveling(this),
      createAutoReplies(this),
      this.aiChat,
      createWelcome(this),
      createTickets(this),
      createGiveaways(this),
      createEconomy(this),
      createCustomCommands(this),
    ];
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
    const client = new Client({ intents: intentsFor(this.spec), partials: [Partials.Channel] });
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
    client.on(Events.GuildMemberAdd, (member) => {
      for (const m of this.modules) m.onMemberAdd?.(member)?.catch?.((e) => this.log(`Welcome error: ${e.message}`));
    });
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
    if (message.author.bot || message.system) return;
    try {
      for (const m of this.modules) {
        if (m.onMessage && (await m.onMessage(message))) return;
      }
    } catch (e) {
      this.log(`Error handling message: ${e.message}`);
      await message.reply({ content: "Something went wrong on my end. Try again in a moment.", allowedMentions: { parse: [] } }).catch(() => {});
    }
  }

  async handleInteraction(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        this.log(`/${interaction.commandName} by ${interaction.user.tag}`);
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
      this.log(`Error in /${interaction.commandName ?? interaction.customId}: ${e.message}`);
      const reply = { content: "Something went wrong running that. Try again in a moment.", flags: MessageFlags.Ephemeral };
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
