import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { guildState } from "../../store.js";
import { randInt } from "../util.js";

const DAY = 864e5;
const HOUR = 36e5;

export function createEconomy(rt) {
  const ephemeral = { flags: MessageFlags.Ephemeral };

  function wallet(guildId, userId) {
    const g = guildState(rt.state, guildId);
    g.coins[userId] ??= { balance: 0, lastDaily: 0, lastWork: 0 };
    return g.coins[userId];
  }

  return {
    commands() {
      const cfg = rt.spec.economy;
      if (!cfg.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("balance")
          .setDescription(`Check your ${cfg.currencyName}`)
          .addUserOption((o) => o.setName("user").setDescription("Someone else")),
        new SlashCommandBuilder().setName("daily").setDescription(`Claim your daily ${cfg.currencyName}`),
        new SlashCommandBuilder().setName("work").setDescription(`Work for ${cfg.currencyName} (once an hour)`),
        new SlashCommandBuilder()
          .setName("pay")
          .setDescription(`Give ${cfg.currencyName} to someone`)
          .addUserOption((o) => o.setName("user").setDescription("Who to pay").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("How much").setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName("richest").setDescription("Richest members"),
      ];
    },

    async onCommand(interaction) {
      const name = interaction.commandName;
      if (!["balance", "daily", "work", "pay", "richest"].includes(name)) return false;
      const { currencyName, currencyEmoji, dailyAmount, workMin, workMax } = rt.spec.economy;
      const fmt = (n) => `${currencyEmoji} **${n.toLocaleString()}** ${currencyName}`;
      const me = wallet(interaction.guildId, interaction.user.id);

      if (name === "balance") {
        const user = interaction.options.getUser("user") ?? interaction.user;
        await interaction.reply(`${user.id === interaction.user.id ? "You have" : `${user.username} has`} ${fmt(wallet(interaction.guildId, user.id).balance)}.`);
      } else if (name === "daily") {
        const wait = me.lastDaily + DAY - Date.now();
        if (wait > 0) {
          await interaction.reply({ content: `You already claimed today. Come back <t:${Math.floor((me.lastDaily + DAY) / 1000)}:R>.`, ...ephemeral });
        } else {
          me.balance += dailyAmount;
          me.lastDaily = Date.now();
          await interaction.reply(`You claimed ${fmt(dailyAmount)}! Balance: ${fmt(me.balance)}.`);
        }
      } else if (name === "work") {
        const wait = me.lastWork + HOUR - Date.now();
        if (wait > 0) {
          await interaction.reply({ content: `You're tired. Work again <t:${Math.floor((me.lastWork + HOUR) / 1000)}:R>.`, ...ephemeral });
        } else {
          const earned = randInt(workMin, workMax);
          me.balance += earned;
          me.lastWork = Date.now();
          await interaction.reply(`You worked hard and earned ${fmt(earned)}. Balance: ${fmt(me.balance)}.`);
        }
      } else if (name === "pay") {
        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (user.id === interaction.user.id || user.bot) {
          await interaction.reply({ content: "Pick another (human) member.", ...ephemeral });
        } else if (me.balance < amount) {
          await interaction.reply({ content: `You only have ${fmt(me.balance)}.`, ...ephemeral });
        } else {
          me.balance -= amount;
          wallet(interaction.guildId, user.id).balance += amount;
          await interaction.reply({ content: `💸 <@${interaction.user.id}> paid <@${user.id}> ${fmt(amount)}.`, allowedMentions: { users: [user.id] } });
        }
      } else {
        const top = Object.entries(guildState(rt.state, interaction.guildId).coins)
          .sort((a, b) => b[1].balance - a[1].balance)
          .slice(0, 10);
        const lines = top.map(([id, w], i) => `**${i + 1}.** <@${id}> — ${fmt(w.balance)}`);
        const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`💰 Richest members`).setDescription(lines.join("\n") || "Nobody has any yet.");
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      }
      rt.state.save();
      return true;
    },
  };
}
