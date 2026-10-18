import { PermissionsBitField } from "discord.js";
import * as ai from "./ai.js";
import { BotRuntime, intentsFor } from "./runtime/bot.js";

const MAX_LOG_LINES = 300;

// Everything the enabled modules might need. Server owners can untick any of these on the invite screen.
const INVITE_PERMISSIONS = new PermissionsBitField([
  "ViewChannel", "SendMessages", "SendMessagesInThreads", "EmbedLinks", "AttachFiles", "ReadMessageHistory",
  "AddReactions", "UseExternalEmojis", "ManageMessages", "ModerateMembers", "ManageChannels", "ManageRoles",
]).bitfield.toString();

// The first segment of a bot token is the bot's user ID, base64-encoded.
export function clientIdFromToken(token) {
  try {
    const id = Buffer.from(token.split(".")[0], "base64").toString("utf8");
    return /^\d{17,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function inviteUrl(clientId) {
  return clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`
    : null;
}

export class BotManager {
  constructor(store, cipher) {
    this.store = store;
    this.cipher = cipher;
    this.runtimes = new Map();
    this.status = new Map(); // id -> { state, error, tag, avatar, guilds, since }
    this.logs = new Map();
  }

  log(id, line) {
    const list = this.logs.get(id) ?? [];
    list.push({ at: new Date().toISOString(), line });
    if (list.length > MAX_LOG_LINES) list.splice(0, list.length - MAX_LOG_LINES);
    this.logs.set(id, list);
  }

  getLogs(id) {
    return this.logs.get(id) ?? [];
  }

  getStatus(id) {
    return this.status.get(id) ?? { state: "stopped" };
  }

  setStatus(id, state, extra = {}) {
    const prev = this.status.get(id) ?? {};
    this.status.set(id, { ...prev, ...extra, state, error: state === "error" ? extra.error : null, since: prev.state === state ? prev.since : Date.now() });
  }

  async start(id) {
    const record = this.store.getBot(id);
    if (!record) throw new Error("Bot not found");
    if (!record.token) throw new Error("Add a Discord bot token first.");
    if (!ai.aiConfigured()) this.log(id, "Warning: ANTHROPIC_API_KEY is not set, so AI replies will fail.");
    await this.stop(id, { keepRunningFlag: true });

    const rt = new BotRuntime({
      id,
      spec: record.spec,
      token: this.cipher.decrypt(record.token),
      ai,
      state: this.store.state(id),
      log: (line) => this.log(id, line),
      onStatus: (state, extra) => this.setStatus(id, state, extra),
    });
    this.runtimes.set(id, rt);
    record.running = true;
    this.store.putBot(record);
    try {
      await rt.start();
    } catch (e) {
      this.runtimes.delete(id);
      record.running = false;
      this.store.putBot(record);
      throw e;
    }
  }

  async stop(id, { keepRunningFlag = false } = {}) {
    const rt = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (rt) {
      await rt.stop();
      this.log(id, "Stopped");
    }
    if (!keepRunningFlag) {
      const record = this.store.getBot(id);
      if (record?.running) {
        record.running = false;
        this.store.putBot(record);
      }
    }
    this.setStatus(id, "stopped");
  }

  // Called after a bot's spec or token changes.
  async applyUpdate(id, { tokenChanged = false, previousSpec = null } = {}) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const record = this.store.getBot(id);
    const intentsChanged = previousSpec && intentsFor(previousSpec).join() !== intentsFor(record.spec).join();
    if (tokenChanged || intentsChanged) {
      this.log(id, "Restarting to apply changes…");
      await this.start(id);
    } else {
      await rt.update(record.spec);
    }
  }

  async syncProfile(id, profile) {
    const rt = this.runtimes.get(id);
    if (!rt?.client?.isReady()) throw Object.assign(new Error("Start the bot first, then sync its profile."), { status: 409 });
    try {
      await rt.syncProfile(profile);
    } catch (e) {
      throw Object.assign(new Error(`Discord refused: ${e.message}. Name and avatar changes are rate-limited (about 2 per hour).`), { status: 400 });
    }
    this.log(id, "Profile synced to Discord");
  }

  async startAll() {
    for (const record of this.store.listBots().filter((b) => b.running)) {
      await this.start(record.id).catch((e) => this.log(record.id, `Auto-start failed: ${e.message}`));
    }
  }

  async stopAll() {
    await Promise.all([...this.runtimes.keys()].map((id) => this.stop(id, { keepRunningFlag: true })));
  }
}
