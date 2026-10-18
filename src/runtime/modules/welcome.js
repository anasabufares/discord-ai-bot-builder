import { fill, findChannel, findRole, splitMessage } from "../util.js";

export function createWelcome(rt) {
  return {
    commands: () => [],
    async onMemberAdd(member) {
      const cfg = rt.spec.welcome;
      if (!cfg.enabled) return;
      const role = findRole(member.guild, cfg.autoRole);
      if (role) await member.roles.add(role, "Welcome auto-role").catch((e) => rt.log(`Auto-role failed: ${e.message}`));

      const channel = findChannel(member.guild, cfg.channel) ?? member.guild.systemChannel;
      if (!channel) return;
      const vars = {
        user: `<@${member.id}>`,
        username: member.displayName,
        server: member.guild.name,
        memberCount: member.guild.memberCount,
      };
      let text = fill(cfg.message, vars);
      if (cfg.useAI) {
        try {
          const ai = await rt.aiChat.oneShot(
            `${member.displayName} just joined ${member.guild.name} (member #${member.guild.memberCount}). Write them a short, warm welcome in your persona. Mention them as {user}. Base it on this template: "${cfg.message}"`,
          );
          text = fill(ai, vars);
        } catch (e) {
          rt.log(`AI welcome failed, using template: ${e.message}`);
        }
      }
      await channel.send({ content: splitMessage(text)[0], allowedMentions: { users: [member.id] } });
    },
  };
}
