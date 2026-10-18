import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { guildState } from "../../store.js";
import { fill, findChannel, findRole, levelFromXp, randInt } from "../util.js";

export function createLeveling(rt) {
  const lastXp = new Map(); // guild:user -> timestamp

  return {
    commands() {
      if (!rt.spec.leveling.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("rank")
          .setDescription("Show your level and XP")
          .addUserOption((o) => o.setName("user").setDescription("Someone else")),
      ];
    },

    // Never consumes the message: other modules (like AI chat) still run.
    async onMessage(message) {
      const cfg = rt.spec.leveling;
      if (!cfg.enabled || !message.guild) return false;
      const key = `${message.guild.id}:${message.author.id}`;
      if (Date.now() - (lastXp.get(key) ?? 0) < cfg.cooldownSeconds * 1000) return false;
      lastXp.set(key, Date.now());

      const g = guildState(rt.state, message.guild.id);
      const before = levelFromXp(g.xp[message.author.id] ?? 0).level;
      g.xp[message.author.id] = (g.xp[message.author.id] ?? 0) + randInt(cfg.xpMin, cfg.xpMax);
      rt.state.save();
      const after = levelFromXp(g.xp[message.author.id]).level;
      if (after <= before) return false;

      const channel = findChannel(message.guild, cfg.announceChannel) ?? message.channel;
      await channel
        .send({ content: fill(cfg.levelUpMessage, { user: `<@${message.author.id}>`, level: after }), allowedMentions: { users: [message.author.id] } })
        .catch(() => {});
      for (const reward of cfg.roleRewards.filter((r) => r.level <= after)) {
        const role = findRole(message.guild, reward.role);
        if (role && !message.member.roles.cache.has(role.id)) {
          await message.member.roles.add(role, `Reached level ${reward.level}`).catch((e) => rt.log(`Role reward failed: ${e.message}`));
        }
      }
      return false;
    },

    async onCommand(interaction) {
      if (!["rank", "leaderboard"].includes(interaction.commandName)) return false;
      const g = guildState(rt.state, interaction.guildId);

      if (interaction.commandName === "rank") {
        const user = interaction.options.getUser("user") ?? interaction.user;
        const xp = g.xp[user.id] ?? 0;
        const { level, progress, needed } = levelFromXp(xp);
        const position = Object.values(g.xp).filter((v) => v > xp).length + 1;
        const filled = Math.round((progress / needed) * 12);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .setDescription(`**Level ${level}** · Rank #${position}\n${"▰".repeat(filled)}${"▱".repeat(12 - filled)} ${progress}/${needed} XP`);
        await interaction.reply({ embeds: [embed] });
      } else {
        const top = Object.entries(g.xp).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const lines = top.map(([id, xp], i) => `**${i + 1}.** <@${id}> — level ${levelFromXp(xp).level} (${xp} XP)`);
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🏆 Leaderboard").setDescription(lines.join("\n") || "No one has earned XP yet.");
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      }
      return true;
    },
  };
}
