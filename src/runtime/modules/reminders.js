import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { parseDuration } from "../util.js";

const MAX_PER_USER = 25;

export function createReminders(rt) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  let timer = null;
  const list = () => (rt.state.data.reminders ??= []);

  async function deliver(r) {
    const text = `⏰ <@${r.userId}>, you asked me to remind you: ${r.text}`;
    const channel = await rt.client.channels.fetch(r.channelId).catch(() => null);
    const sent = await channel?.send({ content: text, allowedMentions: { users: [r.userId] } }).catch(() => null);
    if (!sent) {
      const user = await rt.client.users.fetch(r.userId).catch(() => null);
      await user?.send(`⏰ Reminder: ${r.text}`).catch(() => {});
    }
  }

  return {
    commands() {
      if (!rt.spec.reminders.enabled) return [];
      return [
        new SlashCommandBuilder()
          .setName("remind")
          .setDescription("Set a reminder")
          .addStringOption((o) => o.setName("in").setDescription("When: 10m, 2h, 3d").setRequired(true))
          .addStringOption((o) => o.setName("about").setDescription("What to remind you about").setRequired(true).setMaxLength(500)),
        new SlashCommandBuilder()
          .setName("reminders")
          .setDescription("List or clear your reminders")
          .addBooleanOption((o) => o.setName("clear").setDescription("Delete all your reminders")),
      ];
    },

    onReady() {
      timer = setInterval(async () => {
        const due = list().filter((r) => r.at <= Date.now());
        if (!due.length) return;
        rt.state.data.reminders = list().filter((r) => r.at > Date.now());
        rt.state.save();
        for (const r of due) await deliver(r).catch((e) => rt.log(`Reminder failed: ${e.message}`));
      }, 15_000);
    },

    stop() {
      clearInterval(timer);
    },

    async onCommand(interaction) {
      if (interaction.commandName === "reminders") {
        const mine = list().filter((r) => r.userId === interaction.user.id);
        if (interaction.options.getBoolean("clear")) {
          rt.state.data.reminders = list().filter((r) => r.userId !== interaction.user.id);
          rt.state.save();
          await interaction.reply({ content: `Cleared ${mine.length} reminder${mine.length === 1 ? "" : "s"}.`, ...ephemeral });
        } else {
          const lines = mine.sort((a, b) => a.at - b.at).map((r) => `• <t:${Math.floor(r.at / 1000)}:R>: ${r.text}`);
          await interaction.reply({ content: lines.length ? lines.join("\n") : "You have no reminders.", ...ephemeral });
        }
        return true;
      }
      if (interaction.commandName !== "remind") return false;

      const ms = parseDuration(interaction.options.getString("in", true));
      if (!ms || ms < 60_000 || ms > 365 * 864e5) {
        await interaction.reply({ content: "Use a time like `10m`, `2h` or `3d` (1 minute to 1 year).", ...ephemeral });
        return true;
      }
      if (list().filter((r) => r.userId === interaction.user.id).length >= MAX_PER_USER) {
        await interaction.reply({ content: `You can have up to ${MAX_PER_USER} reminders. Clear some with /reminders.`, ...ephemeral });
        return true;
      }
      const r = { userId: interaction.user.id, channelId: interaction.channelId, text: interaction.options.getString("about", true), at: Date.now() + ms };
      list().push(r);
      rt.state.save();
      await interaction.reply({ content: `Got it. I'll remind you <t:${Math.floor(r.at / 1000)}:R>.`, ...ephemeral });
      return true;
    },
  };
}
