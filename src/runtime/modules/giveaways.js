import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { parseDuration } from "../util.js";

const ENTER_ID = "giveaway:enter";

function pickWinners(entrants, count) {
  const pool = [...entrants];
  const winners = [];
  while (pool.length && winners.length < count) winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return winners;
}

export function createGiveaways(rt) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  let timer = null;
  const all = () => rt.state.data.giveaways;

  const embedFor = (g) =>
    new EmbedBuilder()
      .setColor(g.ended ? 0x99aab5 : 0xfee75c)
      .setTitle(`🎉 ${g.prize}`)
      .setDescription(
        g.ended
          ? `Ended <t:${Math.floor(g.endsAt / 1000)}:R>\nWinners: ${g.winners.length ? g.winners.map((w) => `<@${w}>`).join(", ") : "no valid entries"}`
          : `Click **Enter** to join!\nEnds <t:${Math.floor(g.endsAt / 1000)}:R>\nWinners: ${g.winnerCount}\nEntries: ${g.entrants.length}`,
      )
      .setFooter({ text: `Hosted by ${g.hostTag}` });

  async function finish(g, reroll = false) {
    g.ended = true;
    g.winners = pickWinners(g.entrants, g.winnerCount);
    rt.state.save();
    const channel = await rt.client.channels.fetch(g.channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(g.messageId).catch(() => null);
    await msg?.edit({ embeds: [embedFor(g)], components: [] }).catch(() => {});
    const text = g.winners.length
      ? `🎉 ${reroll ? "New winner" : "Congratulations"} ${g.winners.map((w) => `<@${w}>`).join(", ")}! You won **${g.prize}**!`
      : `Nobody entered the giveaway for **${g.prize}**.`;
    await channel.send({ content: text, allowedMentions: { users: g.winners } });
  }

  return {
    commands() {
      if (!rt.spec.giveaways.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("giveaway")
          .setDescription("Run giveaways")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((s) =>
            s
              .setName("start")
              .setDescription("Start a giveaway in this channel")
              .addStringOption((o) => o.setName("prize").setDescription("What's the prize?").setRequired(true))
              .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m, 2h, 1d").setRequired(true))
              .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(20)),
          )
          .addSubcommand((s) =>
            s.setName("end").setDescription("End a giveaway now").addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),
          )
          .addSubcommand((s) =>
            s.setName("reroll").setDescription("Pick new winners").addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),
          ),
      ];
    },

    onReady() {
      timer = setInterval(() => {
        for (const g of Object.values(all())) {
          if (!g.ended && g.endsAt <= Date.now()) finish(g).catch((e) => rt.log(`Giveaway end failed: ${e.message}`));
        }
      }, 10_000);
    },

    stop() {
      clearInterval(timer);
    },

    async onCommand(interaction) {
      if (interaction.commandName !== "giveaway") return false;
      const sub = interaction.options.getSubcommand();

      if (sub === "start") {
        const ms = parseDuration(interaction.options.getString("duration", true));
        if (!ms || ms < 10_000 || ms > 30 * 864e5) {
          await interaction.reply({ content: "Duration should look like `30m`, `2h` or `1d` (10 seconds to 30 days).", ...ephemeral });
          return true;
        }
        const g = {
          prize: interaction.options.getString("prize", true).slice(0, 200),
          winnerCount: interaction.options.getInteger("winners") ?? 1,
          endsAt: Date.now() + ms,
          channelId: interaction.channelId,
          guildId: interaction.guildId,
          hostTag: interaction.user.tag,
          entrants: [],
          winners: [],
          ended: false,
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ENTER_ID).setLabel("Enter").setEmoji("🎉").setStyle(ButtonStyle.Primary));
        await interaction.reply({ embeds: [embedFor(g)], components: [row] });
        const msg = await interaction.fetchReply();
        g.messageId = msg.id;
        all()[msg.id] = g;
        rt.state.save();
        return true;
      }

      const g = all()[interaction.options.getString("message_id", true)];
      if (!g || g.guildId !== interaction.guildId) {
        await interaction.reply({ content: "I couldn't find that giveaway.", ...ephemeral });
      } else if (sub === "end" && g.ended) {
        await interaction.reply({ content: "That giveaway already ended.", ...ephemeral });
      } else if (sub === "reroll" && !g.ended) {
        await interaction.reply({ content: "That giveaway is still running.", ...ephemeral });
      } else {
        await interaction.reply({ content: sub === "end" ? "Ending giveaway…" : "Rerolling…", ...ephemeral });
        await finish(g, sub === "reroll");
      }
      return true;
    },

    async onButton(interaction) {
      if (interaction.customId !== ENTER_ID) return false;
      const g = all()[interaction.message.id];
      if (!g || g.ended) {
        await interaction.reply({ content: "This giveaway has ended.", ...ephemeral });
        return true;
      }
      const i = g.entrants.indexOf(interaction.user.id);
      if (i >= 0) g.entrants.splice(i, 1);
      else g.entrants.push(interaction.user.id);
      rt.state.save();
      await interaction.update({ embeds: [embedFor(g)] });
      await interaction.followUp({ content: i >= 0 ? "You left the giveaway." : "You're in! 🎉 Good luck.", ...ephemeral });
      return true;
    },
  };
}
