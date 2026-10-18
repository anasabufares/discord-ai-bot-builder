import { EmbedBuilder } from "discord.js";
import { findChannel } from "../util.js";

// Server audit log: joins, leaves, deleted and edited messages, posted to one channel.
export function createLogging(rt) {
  async function post(guild, embed) {
    const cfg = rt.spec.logging;
    if (!cfg.enabled || !guild) return;
    const channel = findChannel(guild, cfg.channel);
    if (channel) await channel.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } }).catch(() => {});
  }
  const clip = (s) => (s && s.length > 1000 ? `${s.slice(0, 1000)}…` : s || "*(no text)*");

  return {
    commands: () => [],

    async onMemberAdd(member) {
      if (!rt.spec.logging.memberJoins) return;
      const age = Math.floor(member.user.createdTimestamp / 1000);
      await post(
        member.guild,
        new EmbedBuilder()
          .setColor(0x3ba55d)
          .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
          .setDescription(`📥 <@${member.id}> joined. Account created <t:${age}:R>. Members: ${member.guild.memberCount}`),
      );
    },

    async onMemberRemove(member) {
      if (!rt.spec.logging.memberLeaves) return;
      await post(
        member.guild,
        new EmbedBuilder()
          .setColor(0x99aab5)
          .setAuthor({ name: member.user?.tag ?? "Unknown user", iconURL: member.user?.displayAvatarURL() })
          .setDescription(`📤 <@${member.id}> left. Members: ${member.guild.memberCount}`),
      );
    },

    async onMessageDelete(message) {
      if (!rt.spec.logging.messageDeletes || message.author?.bot) return;
      await post(
        message.guild,
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Message deleted")
          .setDescription(`In <#${message.channelId}>${message.author ? ` by <@${message.author.id}>` : ""}\n\n${message.partial ? "*(sent before I was watching)*" : clip(message.content)}`),
      );
    },

    async onMessageUpdate(before, after) {
      // Without the old text there's nothing useful to show, so uncached (partial) edits are skipped.
      if (!rt.spec.logging.messageEdits || before.partial || after.partial || !after.author || after.author.bot) return;
      if (before.content === after.content) return;
      await post(
        after.guild,
        new EmbedBuilder()
          .setColor(0xfaa61a)
          .setTitle("Message edited")
          .setURL(after.url)
          .setDescription(`In <#${after.channelId}> by <@${after.author.id}>`)
          .addFields({ name: "Before", value: clip(before.content) }, { name: "After", value: clip(after.content) }),
      );
    },
  };
}
