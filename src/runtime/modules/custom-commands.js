import { SlashCommandBuilder } from "discord.js";
import { fill, splitMessage } from "../util.js";

export function createCustomCommands(rt) {
  return {
    commands() {
      return rt.spec.customCommands.map((c) => {
        const b = new SlashCommandBuilder().setName(c.name).setDescription(c.description);
        if (c.takesInput) b.addStringOption((o) => o.setName("input").setDescription(c.inputDescription).setRequired(true));
        return b;
      });
    },
    async onCommand(interaction) {
      const cmd = rt.spec.customCommands.find((c) => c.name === interaction.commandName);
      if (!cmd) return false;
      const vars = {
        user: `<@${interaction.user.id}>`,
        username: interaction.member?.displayName ?? interaction.user.username,
        server: interaction.guild?.name ?? "DM",
        input: interaction.options.getString("input") ?? "",
      };
      if (cmd.type === "text") {
        await interaction.reply({ content: splitMessage(fill(cmd.response, vars))[0], allowedMentions: { parse: ["users"] } });
        return true;
      }
      await interaction.deferReply();
      const answer = await rt.aiChat.oneShot(fill(cmd.response, vars), vars.username);
      const [first, ...rest] = splitMessage(answer);
      await interaction.editReply({ content: first, allowedMentions: { parse: [] } });
      for (const part of rest) await interaction.followUp({ content: part, allowedMentions: { parse: [] } });
      return true;
    },
  };
}
