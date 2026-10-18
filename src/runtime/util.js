import { ChannelType } from "discord.js";

// Discord caps messages at 2000 characters. Split on newlines, then spaces, then hard-cut.
export function splitMessage(text, limit = 2000) {
  const parts = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const normalizeName = (s) => s.toLowerCase().replace(/^[#@]/, "").trim();

// Resolve a configured channel by ID or by name. Returns null when unset or not found.
export function findChannel(guild, ref, types = [ChannelType.GuildText, ChannelType.GuildAnnouncement]) {
  if (!guild || !ref) return null;
  const byId = guild.channels.cache.get(ref);
  if (byId) return types.includes(byId.type) ? byId : null;
  const name = normalizeName(ref);
  return guild.channels.cache.find((c) => types.includes(c.type) && c.name.toLowerCase() === name) ?? null;
}

export function findRole(guild, ref) {
  if (!guild || !ref) return null;
  const name = normalizeName(ref);
  return guild.roles.cache.get(ref) ?? guild.roles.cache.find((r) => r.name.toLowerCase() === name) ?? null;
}

export function channelMatches(channel, refs) {
  return refs.some((r) => r === channel.id || normalizeName(r) === channel.name?.toLowerCase());
}

// Same curve as most leveling bots: each level needs 5l² + 50l + 100 more XP than the last.
export const xpForNextLevel = (level) => 5 * level * level + 50 * level + 100;

export function levelFromXp(xp) {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
  }
  return { level, progress: remaining, needed: xpForNextLevel(level) };
}

const regexCache = new Map();
export function ruleMatches(rule, content) {
  const text = content.toLowerCase();
  const trigger = rule.trigger.toLowerCase();
  switch (rule.match) {
    case "exact":
      return text.trim() === trigger.trim();
    case "startsWith":
      return text.startsWith(trigger);
    case "regex": {
      if (!regexCache.has(rule.trigger)) {
        let re = null;
        try {
          re = new RegExp(rule.trigger, "i");
        } catch {}
        regexCache.set(rule.trigger, re);
      }
      const re = regexCache.get(rule.trigger);
      return re ? re.test(content.slice(0, 2000)) : false;
    }
    default:
      return text.includes(trigger);
  }
}

export const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export function parseDuration(input) {
  const m = String(input).trim().match(/^(\d+)\s*(s|m|h|d|w)?$/i);
  if (!m) return null;
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[(m[2] || "m").toLowerCase()];
  return Number(m[1]) * mult;
}
