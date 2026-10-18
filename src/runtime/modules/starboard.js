import { EmbedBuilder } from "discord.js";
import { findChannel } from "../util.js";

// Messages that collect enough of the star emoji get reposted to the starboard channel.
export function createStarboard(rt) {
  const posts = () => (rt.state.data.starboard ??= {}); // source message id -> starboard message id

  function emojiMatches(reaction) {
    const want = rt.spec.starboard.emoji;
    return reaction.emoji.name === want || reaction.emoji.id === want || reaction.emoji.toString() === want;
  }

  return {
    commands: () => [],

    async onReaction(reaction) {
      const cfg = rt.spec.starboard;
      if (!cfg.enabled || !emojiMatches(reaction)) return;
      if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
      if (!reaction) return;
      const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
      if (!message?.guild) return;
      const board = findChannel(message.guild, cfg.channel);
      if (!board || board.id === message.channelId) return;

      const count = reaction.count ?? 0;
      const content = `${cfg.emoji} **${count}** · <#${message.channelId}>`;
      const existingId = posts()[message.id];
      if (existingId) {
        const existing = await board.messages.fetch(existingId).catch(() => null);
        if (existing) {
          await existing.edit({ content, allowedMentions: { parse: [] } }).catch(() => {});
          return;
        }
      }
      if (count < cfg.threshold) return;

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setAuthor({ name: message.member?.displayName ?? message.author.username, iconURL: message.author.displayAvatarURL() })
        .setDescription(`${message.content?.slice(0, 3800) || ""}\n\n[Jump to message](${message.url})`)
        .setTimestamp(message.createdAt);
      const image = message.attachments.find((a) => a.contentType?.startsWith("image/"));
      if (image) embed.setImage(image.url);
      const posted = await board.send({ content, embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
      if (posted) {
        posts()[message.id] = posted.id;
        rt.state.save();
      }
    },
  };
}
