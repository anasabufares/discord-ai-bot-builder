import { ChannelType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { channelMatches, splitMessage } from "../util.js";

export const SAFE_MENTIONS = { parse: [], repliedUser: true };
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// Per-channel short-term memory, kept in process (cleared on restart or with /reset).
export function createAiChat(rt) {
  const memory = new Map();
  const cooldowns = new Map();

  function remember(channelId, role, content) {
    const list = memory.get(channelId) ?? [];
    list.push({ role, content });
    const max = rt.spec.aiChat.historyLength;
    while (list.length > max) list.shift();
    // History must start with a user turn.
    while (list.length && list[0].role !== "user") list.shift();
    memory.set(channelId, list);
    return list;
  }

  function onCooldown(userId) {
    const secs = rt.spec.aiChat.cooldownSeconds;
    const last = cooldowns.get(userId) ?? 0;
    if (Date.now() - last < secs * 1000) return true;
    cooldowns.set(userId, Date.now());
    return false;
  }

  // Images go only into the current turn: Discord attachment URLs expire, so memory keeps a text note.
  async function reply(channelId, speaker, text, images = []) {
    const note = images.length ? ` [attached ${images.length} image${images.length > 1 ? "s" : ""}]` : "";
    const history = remember(channelId, "user", `${speaker}: ${text}${note}`).map((m) => ({ ...m }));
    if (images.length) {
      const last = history.at(-1);
      last.content = [...images.map((url) => ({ type: "image", source: { type: "url", url } })), { type: "text", text: last.content }];
    }
    const answer = await rt.ai.chat(rt.spec, history);
    remember(channelId, "assistant", answer);
    return answer;
  }

  function shouldReply(message) {
    const cfg = rt.spec.aiChat;
    if (message.channel.type === ChannelType.DM) return cfg.replyInDMs;
    if (cfg.replyToMentions && message.mentions.users.has(rt.client.user.id)) return true;
    return channelMatches(message.channel, cfg.channels);
  }

  return {
    commands() {
      if (!rt.spec.aiChat.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("ask")
          .setDescription(`Ask ${rt.spec.name} anything`)
          .addStringOption((o) => o.setName("question").setDescription("Your question").setRequired(true)),
        new SlashCommandBuilder().setName("reset").setDescription("Make the bot forget this channel's conversation"),
      ];
    },

    async onMessage(message) {
      if (!rt.spec.aiChat.enabled || !shouldReply(message)) return false;
      if (onCooldown(message.author.id)) return true;
      const text = message.content.replace(new RegExp(`<@!?${rt.client.user.id}>`, "g"), "").trim();
      const images = rt.spec.aiChat.vision
        ? message.attachments.filter((a) => IMAGE_TYPES.has(a.contentType?.split(";")[0])).first(4).map((a) => a.url)
        : [];
      if (!text && !images.length) return false;

      await message.channel.sendTyping().catch(() => {});
      const answer = await reply(message.channel.id, message.member?.displayName ?? message.author.username, text || "(no text)", images);
      const [first, ...rest] = splitMessage(answer);
      await message.reply({ content: first, allowedMentions: SAFE_MENTIONS });
      for (const part of rest) await message.channel.send({ content: part, allowedMentions: { parse: [] } });
      return true;
    },

    async onCommand(interaction) {
      if (interaction.commandName === "reset") {
        memory.delete(interaction.channelId);
        await interaction.reply({ content: "Memory for this channel cleared. 🧹", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.commandName !== "ask") return false;
      if (onCooldown(interaction.user.id)) {
        await interaction.reply({ content: "Slow down a little and try again in a moment.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.deferReply();
      const question = interaction.options.getString("question", true);
      const answer = await reply(interaction.channelId, interaction.member?.displayName ?? interaction.user.username, question);
      const [first, ...rest] = splitMessage(answer);
      await interaction.editReply({ content: first, allowedMentions: { parse: [] } });
      for (const part of rest) await interaction.followUp({ content: part, allowedMentions: { parse: [] } });
      return true;
    },

    // Used by auto-replies, welcome and custom commands for one-off prompts with no memory.
    async oneShot(instruction, speaker = "System") {
      return rt.ai.chat(rt.spec, [{ role: "user", content: `${speaker}: ${instruction}` }]);
    },

    clear() {
      memory.clear();
    },
  };
}
