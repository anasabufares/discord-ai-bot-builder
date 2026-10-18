import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { guildState } from "../../store.js";
import { fill, findChannel, findRole } from "../util.js";

export function createTickets(rt) {
  const ephemeral = { flags: MessageFlags.Ephemeral };

  return {
    commands() {
      if (!rt.spec.tickets.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("ticket")
          .setDescription("Support tickets")
          .addSubcommand((s) =>
            s
              .setName("open")
              .setDescription("Open a private support ticket")
              .addStringOption((o) => o.setName("topic").setDescription("What do you need help with?")),
          )
          .addSubcommand((s) => s.setName("close").setDescription("Close this ticket")),
      ];
    },

    async onCommand(interaction) {
      if (interaction.commandName !== "ticket") return false;
      const cfg = rt.spec.tickets;
      const g = guildState(rt.state, interaction.guildId);
      const sub = interaction.options.getSubcommand();

      if (sub === "open") {
        const existing = Object.entries(g.tickets).find(([, t]) => t.userId === interaction.user.id);
        if (existing && interaction.guild.channels.cache.has(existing[0])) {
          await interaction.reply({ content: `You already have an open ticket: <#${existing[0]}>`, ...ephemeral });
          return true;
        }
        const category = findChannel(interaction.guild, cfg.category, [ChannelType.GuildCategory]);
        const staff = findRole(interaction.guild, cfg.staffRole);
        const number = ++g.ticketCount;
        const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles];
        const channel = await interaction.guild.channels.create({
          name: `ticket-${String(number).padStart(4, "0")}`,
          type: ChannelType.GuildText,
          parent: category?.id,
          topic: interaction.options.getString("topic") ?? `Ticket for ${interaction.user.tag}`,
          permissionOverwrites: [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow },
            { id: rt.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] },
            ...(staff ? [{ id: staff.id, allow }] : []),
          ],
        });
        g.tickets[channel.id] = { userId: interaction.user.id, number, openedAt: new Date().toISOString() };
        rt.state.save();
        await channel.send({
          content: `${fill(cfg.openMessage, { user: `<@${interaction.user.id}>` })}${staff ? `\n<@&${staff.id}>` : ""}\n\nUse \`/ticket close\` when you're done.`,
          allowedMentions: { users: [interaction.user.id], roles: staff ? [staff.id] : [] },
        });
        await interaction.reply({ content: `🎫 Ticket opened: <#${channel.id}>`, ...ephemeral });
        rt.log(`Ticket #${number} opened by ${interaction.user.tag}`);
      } else {
        const ticket = g.tickets[interaction.channelId];
        if (!ticket) {
          await interaction.reply({ content: "This isn't a ticket channel.", ...ephemeral });
          return true;
        }
        const staff = findRole(interaction.guild, cfg.staffRole);
        const canClose =
          ticket.userId === interaction.user.id ||
          (staff && interaction.member.roles.cache.has(staff.id)) ||
          interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels);
        if (!canClose) {
          await interaction.reply({ content: "Only the ticket owner or staff can close this.", ...ephemeral });
          return true;
        }
        delete g.tickets[interaction.channelId];
        rt.state.save();
        await interaction.reply("🔒 Closing this ticket in 5 seconds…");
        setTimeout(() => interaction.channel.delete("Ticket closed").catch((e) => rt.log(`Couldn't delete ticket: ${e.message}`)), 5000);
      }
      return true;
    },
  };
}
