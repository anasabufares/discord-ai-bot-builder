import { fill, ruleMatches, splitMessage } from "../util.js";

export function createAutoReplies(rt) {
  return {
    commands: () => [],
    async onMessage(message) {
      const cfg = rt.spec.autoReplies;
      if (!cfg.enabled || !message.content) return false;
      const rule = cfg.rules.find((r) => ruleMatches(r, message.content));
      if (!rule) return false;

      const vars = {
        user: `<@${message.author.id}>`,
        username: message.member?.displayName ?? message.author.username,
        server: message.guild?.name ?? "DM",
      };
      let text;
      if (rule.useAI) {
        await message.channel.sendTyping().catch(() => {});
        text = await rt.aiChat.oneShot(`${fill(rule.response, vars)}\n\nThe message you're responding to: "${message.content}"`, vars.username);
      } else {
        text = fill(rule.response, vars);
      }
      await message.reply({ content: splitMessage(text)[0], allowedMentions: { parse: ["users"], repliedUser: true } });
      return true;
    },
  };
}
