import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { findRole } from "../util.js";

const PREFIX = "selfrole:";

export function createSelfRoles(rt) {
  const ephemeral = { flags: MessageFlags.Ephemeral };

  function panelMessage(panel, guild) {
    const missing = [];
    const buttons = [];
    for (const r of panel.roles) {
      const role = findRole(guild, r.role);
      if (!role) {
        missing.push(r.role);
        continue;
      }
      const b = new ButtonBuilder().setCustomId(`${PREFIX}${role.id}`).setLabel(r.label).setStyle(ButtonStyle.Secondary);
      if (r.emoji) b.setEmoji(r.emoji);
      buttons.push(b);
    }
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(panel.title).setDescription(panel.description || "Click a button to add or remove a role.");
    return { message: { embeds: [embed], components: rows }, missing };
  }

  return {
    commands() {
      if (!rt.spec.selfRoles.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("selfroles")
          .setDescription("Post the self-role panels in this channel")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
      ];
    },

    async onCommand(interaction) {
      if (interaction.commandName !== "selfroles") return false;
      const panels = rt.spec.selfRoles.panels;
      if (!panels.length) {
        await interaction.reply({ content: "No role panels are set up yet. Add them in the dashboard.", ...ephemeral });
        return true;
      }
      await interaction.deferReply(ephemeral);
      const missing = [];
      let posted = 0;
      for (const panel of panels) {
        const built = panelMessage(panel, interaction.guild);
        missing.push(...built.missing);
        if (!built.message.components.length) continue;
        await interaction.channel.send(built.message);
        posted++;
      }
      await interaction.editReply(
        `Posted ${posted} panel${posted === 1 ? "" : "s"}.${missing.length ? ` I couldn't find these roles: ${missing.join(", ")}. Create them or fix the names in the dashboard.` : ""}`,
      );
      return true;
    },

    async onButton(interaction) {
      if (!interaction.customId.startsWith(PREFIX)) return false;
      const roleId = interaction.customId.slice(PREFIX.length);
      // Only roles still configured on a panel can be self-assigned, even if an old message has other buttons.
      const allowed = rt.spec.selfRoles.enabled && rt.spec.selfRoles.panels.some((p) => p.roles.some((r) => findRole(interaction.guild, r.role)?.id === roleId));
      const role = interaction.guild.roles.cache.get(roleId);
      if (!allowed || !role) {
        await interaction.reply({ content: "That role isn't available anymore.", ...ephemeral });
        return true;
      }
      const member = interaction.member;
      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(role, "Self-role");
          await interaction.reply({ content: `Removed **${role.name}**.`, ...ephemeral });
        } else {
          await member.roles.add(role, "Self-role");
          await interaction.reply({ content: `Gave you **${role.name}**. ✅`, ...ephemeral });
        }
      } catch {
        await interaction.reply({ content: "I couldn't change that role. My role needs to be above it in Server Settings → Roles.", ...ephemeral });
      }
      return true;
    },
  };
}
