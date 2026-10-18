import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { guildState } from "../../store.js";
import { findChannel } from "../util.js";

const INVITE_RE = /(discord\.gg|discord(app)?\.com\/invite)\/\S+/i;
const LINK_RE = /https?:\/\/\S+/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createModeration(rt) {
  const recent = new Map(); // userId -> timestamps, for anti-spam
  let wordRe = null;
  let wordKey = "";

  function bannedWordHit(content) {
    const words = rt.spec.moderation.bannedWords;
    const key = words.join("\u0000");
    if (key !== wordKey) {
      wordKey = key;
      wordRe = words.length ? new RegExp(`\\b(${words.map(escapeRe).join("|")})\\b`, "i") : null;
    }
    return wordRe?.exec(content)?.[0] ?? null;
  }

  function isSpam(userId) {
    const { enabled, maxMessages, perSeconds } = rt.spec.moderation.antiSpam;
    if (!enabled) return false;
    const now = Date.now();
    const list = (recent.get(userId) ?? []).filter((t) => now - t < perSeconds * 1000);
    list.push(now);
    recent.set(userId, list);
    return list.length > maxMessages;
  }

  function addWarning(guildId, userId, reason, by) {
    const g = guildState(rt.state, guildId);
    (g.warnings[userId] ??= []).push({ reason, by, at: new Date().toISOString() });
    rt.state.save();
    return g.warnings[userId].length;
  }

  async function logAction(guild, title, fields) {
    const channel = findChannel(guild, rt.spec.moderation.logChannel);
    if (!channel) return;
    const embed = new EmbedBuilder().setTitle(title).setColor(0xed4245).setTimestamp();
    for (const [name, value] of Object.entries(fields)) embed.addFields({ name, value: String(value).slice(0, 1024) || "—" });
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  async function enforce(message, reason) {
    const cfg = rt.spec.moderation;
    await message.delete().catch((e) => rt.log(`Couldn't delete message: ${e.message}`));
    const member = message.member;
    if (cfg.action === "warn" || cfg.action === "timeout") {
      const count = addWarning(message.guild.id, message.author.id, reason, rt.client.user.id);
      await message.channel
        .send({ content: `⚠️ <@${message.author.id}>, your message was removed: ${reason}. (warning ${count})`, allowedMentions: { users: [message.author.id] } })
        .catch(() => {});
    }
    if (cfg.action === "timeout" && member?.moderatable) {
      await member.timeout(cfg.timeoutMinutes * 60_000, reason).catch((e) => rt.log(`Timeout failed: ${e.message}`));
    }
    await logAction(message.guild, "Message removed", {
      User: `<@${message.author.id}> (${message.author.tag})`,
      Channel: `<#${message.channel.id}>`,
      Reason: reason,
      Content: message.content,
    });
    rt.log(`Moderation: removed message from ${message.author.tag} (${reason})`);
  }

  return {
    commands() {
      if (!rt.spec.moderation.enabled) return [];
      const mod = PermissionFlagsBits.ModerateMembers;
      return [
        new SlashCommandBuilder()
          .setName("warn")
          .setDescription("Warn a member")
          .setDefaultMemberPermissions(mod)
          .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
        new SlashCommandBuilder()
          .setName("warnings")
          .setDescription("Show a member's warnings")
          .setDefaultMemberPermissions(mod)
          .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
        new SlashCommandBuilder()
          .setName("timeout")
          .setDescription("Time out a member")
          .setDefaultMemberPermissions(mod)
          .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
          .addIntegerOption((o) => o.setName("minutes").setDescription("Minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
          .addStringOption((o) => o.setName("reason").setDescription("Reason")),
        new SlashCommandBuilder()
          .setName("purge")
          .setDescription("Delete recent messages in this channel")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
          .addIntegerOption((o) => o.setName("amount").setDescription("How many (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
      ];
    },

    async onMessage(message) {
      const cfg = rt.spec.moderation;
      if (!cfg.enabled || !message.guild) return false;
      // Never moderate people who can moderate.
      if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
      const content = message.content ?? "";

      const word = bannedWordHit(content);
      if (word) return enforce(message, "banned word").then(() => true);
      if (cfg.blockInvites && INVITE_RE.test(content)) return enforce(message, "server invites aren't allowed").then(() => true);
      if (cfg.blockLinks && LINK_RE.test(content)) return enforce(message, "links aren't allowed").then(() => true);
      if (isSpam(message.author.id)) return enforce(message, "spamming").then(() => true);

      if (cfg.aiModeration && content.length >= 3) {
        try {
          const verdict = await rt.ai.moderate(content);
          if (verdict.flagged) {
            await enforce(message, verdict.reason || "breaks the server rules");
            return true;
          }
        } catch (e) {
          rt.log(`AI moderation unavailable: ${e.message}`);
        }
      }
      return false;
    },

    async onCommand(interaction) {
      const name = interaction.commandName;
      if (!["warn", "warnings", "timeout", "purge"].includes(name)) return false;
      const ephemeral = { flags: MessageFlags.Ephemeral };

      if (name === "warn") {
        const user = interaction.options.getUser("user", true);
        const reason = interaction.options.getString("reason", true);
        const count = addWarning(interaction.guildId, user.id, reason, interaction.user.id);
        await interaction.reply({ content: `⚠️ Warned <@${user.id}>: ${reason} (warning ${count})`, allowedMentions: { users: [user.id] } });
        await logAction(interaction.guild, "Member warned", { User: `<@${user.id}>`, By: `<@${interaction.user.id}>`, Reason: reason });
      } else if (name === "warnings") {
        const user = interaction.options.getUser("user", true);
        const list = guildState(rt.state, interaction.guildId).warnings[user.id] ?? [];
        const lines = list.slice(-15).map((w, i) => `**${i + 1}.** ${w.reason} — <t:${Math.floor(Date.parse(w.at) / 1000)}:R>`);
        await interaction.reply({ content: lines.length ? `Warnings for <@${user.id}>:\n${lines.join("\n")}` : `<@${user.id}> has no warnings.`, ...ephemeral, allowedMentions: { parse: [] } });
      } else if (name === "timeout") {
        const member = interaction.options.getMember("user");
        const minutes = interaction.options.getInteger("minutes", true);
        const reason = interaction.options.getString("reason") ?? "No reason given";
        if (!member?.moderatable) {
          await interaction.reply({ content: "I can't time out that member (check my role is above theirs).", ...ephemeral });
        } else {
          await member.timeout(minutes * 60_000, reason);
          await interaction.reply({ content: `🔇 Timed out <@${member.id}> for ${minutes} min: ${reason}`, allowedMentions: { parse: [] } });
          await logAction(interaction.guild, "Member timed out", { User: `<@${member.id}>`, By: `<@${interaction.user.id}>`, Minutes: minutes, Reason: reason });
        }
      } else if (name === "purge") {
        const amount = interaction.options.getInteger("amount", true);
        const deleted = await interaction.channel.bulkDelete(amount, true);
        await interaction.reply({ content: `🧹 Deleted ${deleted.size} messages.`, ...ephemeral });
      }
      return true;
    },
  };
}
