import fs from "node:fs";
import path from "node:path";

// A tiny JSON-file store. Writes are debounced and atomic (write temp file, then rename),
// which is plenty for a single-process dashboard hosting a handful of bots.
class JsonFile {
  constructor(file, initial) {
    this.file = file;
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      this.data = structuredClone(initial);
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(path.join(dataDir, "state"), { recursive: true });
    this.bots = new JsonFile(path.join(dataDir, "bots.json"), { bots: {} });
    this.states = new Map();
  }

  listBots() {
    return Object.values(this.bots.data.bots).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getBot(id) {
    return this.bots.data.bots[id] ?? null;
  }

  putBot(record) {
    this.bots.data.bots[record.id] = record;
    this.bots.save();
    return record;
  }

  deleteBot(id) {
    delete this.bots.data.bots[id];
    this.bots.save();
    this.states.delete(id);
    fs.rmSync(path.join(this.dataDir, "state", `${id}.json`), { force: true });
  }

  // Per-bot runtime data: XP, coins, warnings, giveaways, tickets. Keyed by guild.
  state(botId) {
    if (!/^[a-f0-9-]{36}$/.test(botId)) throw new Error("Invalid bot id");
    if (!this.states.has(botId)) {
      this.states.set(botId, new JsonFile(path.join(this.dataDir, "state", `${botId}.json`), { guilds: {}, giveaways: {} }));
    }
    return this.states.get(botId);
  }

  flushAll() {
    this.bots.flush();
    for (const s of this.states.values()) s.flush();
  }
}

export function guildState(file, guildId) {
  file.data.guilds[guildId] ??= { xp: {}, coins: {}, warnings: {}, tickets: {}, ticketCount: 0 };
  return file.data.guilds[guildId];
}
