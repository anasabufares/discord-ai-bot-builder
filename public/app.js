// Botsmith dashboard. Plain ES modules, no build step. All user data goes through h() / textContent,
// never innerHTML, so bot names and AI output can't inject markup.

const $app = document.getElementById("app");

// ---- tiny helpers ----------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    // CSSOM writes are allowed under our CSP; inline style attributes are not.
    else if (k === "style") el.style.cssText = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(message, kind = "info") {
  const t = h("div", { class: `toast ${kind}` }, message);
  document.getElementById("toast").append(t);
  setTimeout(() => t.remove(), kind === "error" ? 7000 : 3500);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") {
    state.authed = false;
    render();
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const clone = (v) => structuredClone(v);
const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}
const initial = (name) => (name || "?").trim().charAt(0).toUpperCase();

async function busy(button, fn) {
  const label = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(h("span", { class: "spinner" }), " Working…");
  try {
    return await fn();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    button.disabled = false;
    button.replaceChildren(...label);
  }
}

// ---- state -----------------------------------------------------------------

const state = {
  authed: true,
  meta: null,
  bots: [],
  view: "new", // "new" | bot id
  tab: "overview",
  draft: null, // editable copy of the selected bot's spec
  dirty: false,
  generated: null, // preview from the AI builder on the "new bot" screen
  chat: [],
  pollTimer: null,
};

const selected = () => state.bots.find((b) => b.id === state.view);

function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    renderSavebar();
  }
}

async function refreshBots() {
  state.bots = await api("/bots");
}

function selectBot(id, tab = "overview") {
  if (state.dirty && !confirm("You have unsaved changes. Discard them?")) return;
  state.view = id;
  state.tab = tab;
  state.dirty = false;
  state.chat = [];
  state.draft = id === "new" ? null : clone(selected()?.spec ?? null);
  render();
}

// ---- field renderers -------------------------------------------------------

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label), hint && h("small", {}, hint), input);
}

function bindText(obj, path, { multiline = false, placeholder = "", rows } = {}) {
  const props = {
    value: getPath(obj, path) ?? "",
    placeholder,
    oninput: (e) => {
      setPath(obj, path, e.target.value);
      markDirty();
    },
  };
  return multiline ? h("textarea", { ...props, rows: rows ?? 4 }) : h("input", { type: "text", ...props });
}

function bindNumber(obj, path) {
  return h("input", {
    type: "number",
    value: getPath(obj, path),
    oninput: (e) => {
      setPath(obj, path, Number(e.target.value));
      markDirty();
    },
  });
}

function bindSelect(obj, path, options) {
  const sel = h("select", {
    onchange: (e) => {
      setPath(obj, path, e.target.value);
      markDirty();
    },
  });
  for (const [value, label] of options) sel.append(h("option", { value, selected: getPath(obj, path) === value }, label));
  return sel;
}

// A <label> so clicking the track toggles it; toggleRow passes "span" because it's already inside a label.
function bindSwitch(obj, path, onChange, tag = "label") {
  return h(
    tag,
    { class: "switch" },
    h("input", {
      type: "checkbox",
      checked: Boolean(getPath(obj, path)),
      onchange: (e) => {
        setPath(obj, path, e.target.checked);
        markDirty();
        onChange?.(e.target.checked);
      },
    }),
    h("i"),
  );
}

function toggleRow(label, obj, path, hint) {
  return h("label", { class: "toggle-row" }, h("div", {}, h("div", {}, label), hint && h("div", { class: "muted small" }, hint)), bindSwitch(obj, path, null, "span"));
}

// Comma- or newline-separated list of strings.
function bindList(obj, path, placeholder) {
  return h("input", {
    type: "text",
    value: (getPath(obj, path) ?? []).join(", "),
    placeholder,
    oninput: (e) => {
      setPath(
        obj,
        path,
        e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
      );
      markDirty();
    },
  });
}

// A list of objects with an add/remove UI. renderItem(item) returns the item's fields.
function repeater(obj, path, { blank, renderItem, addLabel }) {
  const wrap = h("div", { class: "repeater" });
  const draw = () => {
    const items = getPath(obj, path);
    wrap.replaceChildren(
      ...items.map((item, i) =>
        h(
          "div",
          { class: "repeater-item" },
          renderItem(item),
          h(
            "div",
            { class: "row" },
            h(
              "button",
              {
                class: "btn danger small",
                type: "button",
                onclick: () => {
                  items.splice(i, 1);
                  markDirty();
                  draw();
                },
              },
              "Remove",
            ),
          ),
        ),
      ),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            items.push(clone(blank));
            markDirty();
            draw();
          },
        },
        `+ ${addLabel}`,
      ),
    );
  };
  draw();
  return wrap;
}

// ---- module definitions -----------------------------------------------------

const CHANNEL_HINT = "Channel name (like welcome) or ID";
const MODULES = [
  {
    key: "aiChat",
    icon: "💬",
    title: "AI Chat",
    blurb: "Talks in your persona when mentioned, in DMs, or in chosen channels. Adds /ask and /reset.",
    body: (m) => [
      toggleRow("Reply when @mentioned", m, "replyToMentions"),
      toggleRow("Reply in DMs", m, "replyInDMs"),
      toggleRow("Web search", m, "webSearch", "Looks up current info (news, scores, patch notes). About $0.01 per search."),
      toggleRow("See images", m, "vision", "Reads screenshots and photos members attach."),
      field("Always-on channels", bindList(m, "channels", "ai-chat, general"), "The bot replies to every message here, no mention needed."),
      h("div", { class: "grid two" }, field("Memory (messages)", bindNumber(m, "historyLength")), field("Cooldown per user (seconds)", bindNumber(m, "cooldownSeconds"))),
    ],
  },
  {
    key: "autoReplies",
    icon: "⚡",
    title: "Auto Replies",
    blurb: "Instant answers when a message matches a trigger. Optionally let the AI write the answer.",
    body: (m) => [
      repeater(m, "rules", {
        addLabel: "Add rule",
        blank: { trigger: "", match: "contains", response: "", useAI: false },
        renderItem: (r) => [
          h(
            "div",
            { class: "grid two" },
            field("When a message…", bindSelect(r, "match", [["contains", "contains"], ["exact", "is exactly"], ["startsWith", "starts with"], ["regex", "matches regex"]])),
            field("Trigger", bindText(r, "trigger", { placeholder: "server ip" })),
          ),
          field("Reply", bindText(r, "response", { multiline: true, rows: 2, placeholder: "Our server IP is play.example.com" }), "With AI on, this is an instruction for the AI instead. {user} {username} {server}"),
          toggleRow("Let AI write the reply", r, "useAI"),
        ],
      }),
    ],
  },
  {
    key: "moderation",
    icon: "🛡️",
    title: "Moderation",
    blurb: "Filters banned words, invites, links and spam, with optional AI moderation. Adds /warn, /warnings, /timeout, /purge.",
    body: (m) => [
      field("Banned words", bindList(m, "bannedWords", "word1, word2")),
      toggleRow("Block Discord invites", m, "blockInvites"),
      toggleRow("Block all links", m, "blockLinks"),
      toggleRow("AI moderation", m, "aiModeration", "Catches harassment, hate and threats that word lists miss. Uses a fast, cheap model."),
      toggleRow("Anti-spam", m, "antiSpam.enabled"),
      h("div", { class: "grid two" }, field("Max messages", bindNumber(m, "antiSpam.maxMessages")), field("…within seconds", bindNumber(m, "antiSpam.perSeconds"))),
      h(
        "div",
        { class: "grid two" },
        field("Action", bindSelect(m, "action", [["delete", "Delete message"], ["warn", "Delete + warn"], ["timeout", "Delete + warn + timeout"]])),
        field("Timeout length (minutes)", bindNumber(m, "timeoutMinutes")),
      ),
      field("Log channel", bindText(m, "logChannel", { placeholder: "mod-log" }), CHANNEL_HINT),
      h("div", { class: "muted small" }, "Members with Manage Messages are never auto-moderated."),
    ],
  },
  {
    key: "welcome",
    icon: "👋",
    title: "Welcome",
    blurb: "Greets new members and can give them a role.",
    body: (m) => [
      field("Channel", bindText(m, "channel", { placeholder: "welcome" }), `${CHANNEL_HINT}. Empty = the server's system channel.`),
      field("Message", bindText(m, "message", { multiline: true, rows: 2 }), "{user} {username} {server} {memberCount}"),
      toggleRow("Let AI write each welcome", m, "useAI"),
      field("Auto role", bindText(m, "autoRole", { placeholder: "Member" }), "Role name or ID. Leave empty for none."),
    ],
  },
  {
    key: "leveling",
    icon: "📈",
    title: "Leveling",
    blurb: "XP for chatting, level-up announcements and role rewards. Adds /rank and /leaderboard.",
    body: (m) => [
      h("div", { class: "grid two" }, field("XP per message (min)", bindNumber(m, "xpMin")), field("XP per message (max)", bindNumber(m, "xpMax"))),
      field("XP cooldown (seconds)", bindNumber(m, "cooldownSeconds")),
      field("Announce channel", bindText(m, "announceChannel", { placeholder: "level-ups" }), "Empty = the channel they leveled up in."),
      field("Level-up message", bindText(m, "levelUpMessage"), "{user} {level}"),
      h("h3", {}, "Role rewards"),
      repeater(m, "roleRewards", {
        addLabel: "Add reward",
        blank: { level: 5, role: "" },
        renderItem: (r) => h("div", { class: "grid two" }, field("At level", bindNumber(r, "level")), field("Give role", bindText(r, "role", { placeholder: "Regular" }))),
      }),
    ],
  },
  {
    key: "tickets",
    icon: "🎫",
    title: "Tickets",
    blurb: "Private support channels with /ticket open and /ticket close.",
    body: (m) => [
      h("div", { class: "grid two" }, field("Category", bindText(m, "category", { placeholder: "Support" })), field("Staff role", bindText(m, "staffRole", { placeholder: "Moderators" }))),
      field("Opening message", bindText(m, "openMessage", { multiline: true, rows: 2 }), "{user}"),
    ],
  },
  {
    key: "giveaways",
    icon: "🎉",
    title: "Giveaways",
    blurb: "Button-entry giveaways with /giveaway start, end and reroll.",
    body: () => [h("div", { class: "muted small" }, "No settings needed. Members with Manage Server can run giveaways.")],
  },
  {
    key: "selfRoles",
    icon: "🏷️",
    title: "Self Roles",
    blurb: "Button panels members click to give themselves roles. Post them with /selfroles.",
    body: (m) => [
      repeater(m, "panels", {
        addLabel: "Add panel",
        blank: { title: "Pick your roles", description: "", roles: [] },
        renderItem: (p) => [
          field("Panel title", bindText(p, "title")),
          field("Description", bindText(p, "description", { multiline: true, rows: 2 })),
          repeater(p, "roles", {
            addLabel: "Add role button",
            blank: { role: "", label: "", emoji: "" },
            renderItem: (r) => h("div", { class: "grid three" }, field("Role", bindText(r, "role", { placeholder: "Gamer" })), field("Button label", bindText(r, "label")), field("Emoji", bindText(r, "emoji", { placeholder: "🎮" }))),
          }),
        ],
      }),
      h("div", { class: "muted small" }, "The bot's role must sit above these roles in Server Settings → Roles."),
    ],
  },
  {
    key: "reminders",
    icon: "⏰",
    title: "Reminders",
    blurb: "Members set personal reminders with /remind and manage them with /reminders.",
    body: () => [h("div", { class: "muted small" }, "No settings needed. Each member can have up to 25 reminders.")],
  },
  {
    key: "logging",
    icon: "📜",
    title: "Server Log",
    blurb: "Posts joins, leaves, deleted and edited messages to a log channel.",
    body: (m) => [
      field("Log channel", bindText(m, "channel", { placeholder: "mod-log" }), CHANNEL_HINT),
      toggleRow("Member joins", m, "memberJoins"),
      toggleRow("Member leaves", m, "memberLeaves"),
      toggleRow("Deleted messages", m, "messageDeletes"),
      toggleRow("Edited messages", m, "messageEdits"),
    ],
  },
  {
    key: "starboard",
    icon: "⭐",
    title: "Starboard",
    blurb: "Reposts messages that get enough star reactions to a hall-of-fame channel.",
    body: (m) => [
      h("div", { class: "grid three" }, field("Channel", bindText(m, "channel", { placeholder: "starboard" })), field("Emoji", bindText(m, "emoji")), field("Reactions needed", bindNumber(m, "threshold"))),
    ],
  },
  {
    key: "economy",
    icon: "🪙",
    title: "Economy",
    blurb: "Server currency with /balance, /daily, /work, /pay and /richest.",
    body: (m) => [
      h("div", { class: "grid two" }, field("Currency name", bindText(m, "currencyName")), field("Currency emoji", bindText(m, "currencyEmoji"))),
      field("Daily reward", bindNumber(m, "dailyAmount")),
      h("div", { class: "grid two" }, field("Work pays (min)", bindNumber(m, "workMin")), field("Work pays (max)", bindNumber(m, "workMax"))),
    ],
  },
];

const enabledModules = (spec) => MODULES.filter((m) => spec[m.key].enabled);

// ---- views -------------------------------------------------------------------

function renderLogin() {
  const pw = h("input", { type: "password", placeholder: "Dashboard password", autocomplete: "current-password" });
  const button = h("button", { class: "btn primary block", type: "submit" }, "Sign in");
  const form = h(
    "form",
    {
      class: "card",
      onsubmit: (e) => {
        e.preventDefault();
        busy(button, async () => {
          await api("/login", { method: "POST", body: { password: pw.value } });
          state.authed = true;
          await boot();
        });
      },
    },
    h("div", { class: "brand" }, h("span", {}, "🤖"), "Botsmith"),
    h("div", { class: "muted" }, "Sign in to manage your bots."),
    pw,
    button,
  );
  $app.replaceChildren(h("div", { class: "login" }, form));
  pw.focus();
}

function renderSidebar() {
  return h(
    "aside",
    { class: "sidebar" },
    h("div", { class: "brand" }, h("span", {}, "🤖"), "Botsmith"),
    h("button", { class: "btn primary block", onclick: () => selectBot("new") }, "+ New bot"),
    h("div", { class: "muted small", style: "margin:14px 6px 4px" }, "YOUR BOTS"),
    state.bots.length === 0 && h("div", { class: "muted small", style: "padding:0 6px" }, "No bots yet."),
    state.bots.map((b) =>
      h(
        "button",
        { class: `bot-link ${state.view === b.id ? "active" : ""}`, onclick: () => selectBot(b.id) },
        avatar(b),
        h("span", { class: "name" }, b.spec.name),
        h("span", { class: `dot ${b.status.state}`, title: b.status.state }),
      ),
    ),
    h("div", { class: "spacer" }),
    h(
      "button",
      {
        class: "btn block",
        onclick: async () => {
          await api("/logout", { method: "POST", body: {} });
          state.authed = false;
          render();
        },
      },
      "Sign out",
    ),
  );
}

function avatar(bot, size = "") {
  return h("div", { class: `avatar ${size}` }, bot.status?.avatar ? h("img", { src: bot.status.avatar, alt: "" }) : initial(bot.spec.name));
}

const EXAMPLES = [
  "A sarcastic pirate who answers questions about our Minecraft server and warns people who spam",
  "A cozy study buddy for a homework server: explains concepts patiently, has /quiz and /explain commands, and gives XP for chatting",
  "A full community manager: welcomes new members, moderation with AI, tickets for support, giveaways and a coin economy",
  "An anime-loving hype bot that greets members, runs giveaways and gives roles at level 5, 10 and 20",
];

function renderNewBot() {
  const desc = h("textarea", { placeholder: "Describe the bot you want… e.g. a friendly support bot for my game studio that answers FAQs, opens tickets and moderates links" });
  const generate = h("button", { class: "btn primary", type: "button" }, "✨ Build with AI");
  generate.onclick = () =>
    busy(generate, async () => {
      const { spec } = await api("/generate", { method: "POST", body: { description: desc.value } });
      state.generated = spec;
      renderMain();
    });

  const blank = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: () => {
        state.generated = clone(state.meta.defaults);
        renderMain();
      },
    },
    "Start from scratch",
  );

  const hero = h(
    "div",
    { class: "hero" },
    h("h1", {}, "Describe it. We'll build it."),
    h("p", { class: "muted" }, "Tell the AI what your Discord bot should do. It writes the personality, turns on the right modules and creates the commands, and you can fine-tune everything afterwards."),
    h(
      "div",
      { class: "prompt-box" },
      desc,
      h("div", { class: "row" }, blank, generate),
    ),
    !state.meta.aiConfigured && h("p", { class: "notice", style: "max-width:760px;margin:16px auto;text-align:left" }, "ANTHROPIC_API_KEY isn't set on the server, so the AI builder and AI replies won't work yet. Add it to .env and restart."),
    h("div", { class: "chips", style: "justify-content:center;max-width:760px;margin:18px auto 0" }, EXAMPLES.map((ex) => h("button", { class: "chip", type: "button", onclick: () => (desc.value = ex) }, ex))),
  );

  const templates = h(
    "div",
    { class: "templates" },
    h("h2", {}, "Or start from a template"),
    h(
      "div",
      { class: "template-grid" },
      state.meta.templates.map((t) =>
        h(
          "button",
          {
            class: "template",
            type: "button",
            onclick: () => {
              state.generated = clone(t.spec);
              renderMain();
              document.querySelector(".preview")?.scrollIntoView({ behavior: "smooth" });
            },
          },
          h("div", { class: "template-icon" }, t.icon),
          h("div", {}, h("div", { class: "template-title" }, t.title), h("div", { class: "muted small" }, t.blurb)),
        ),
      ),
    ),
  );

  return [hero, state.generated && renderPreview(state.generated), templates];
}

function renderPreview(spec) {
  const token = h("input", { type: "password", placeholder: "Paste bot token (optional, you can add it later)", autocomplete: "off" });
  const create = h("button", { class: "btn primary" }, "Create bot");
  create.onclick = () =>
    busy(create, async () => {
      const bot = await api("/bots", { method: "POST", body: { spec, token: token.value } });
      state.generated = null;
      await refreshBots();
      selectBot(bot.id);
      toast(`${bot.spec.name} created`);
    });

  return h(
    "div",
    { class: "card preview", style: "max-width:760px;margin:28px auto 0" },
    h("div", { class: "card-head" }, h("div", { class: "avatar lg" }, initial(spec.name)), h("div", { class: "title" }, h("h2", {}, spec.name), h("div", { class: "muted" }, spec.description))),
    h(
      "div",
      { class: "card-body" },
      h("div", { class: "chips" }, enabledModules(spec).map((m) => h("span", { class: "pill" }, m.icon, " ", m.title))),
      spec.customCommands.length > 0 && h("div", { class: "muted small" }, "Commands: ", spec.customCommands.map((c) => `/${c.name}`).join("  ")),
      h("details", {}, h("summary", { class: "muted small" }, "Personality"), h("p", { style: "white-space:pre-wrap" }, spec.persona.systemPrompt)),
      field("Discord bot token", token, "From discord.com/developers → your app → Bot → Reset Token. It's stored encrypted."),
      h("div", { class: "row" }, create, h("button", { class: "btn", onclick: () => ((state.generated = null), renderMain()) }, "Discard")),
    ),
  );
}

const TABS = [
  ["overview", "Overview"],
  ["persona", "Persona"],
  ["knowledge", "Knowledge"],
  ["modules", "Modules"],
  ["commands", "Commands"],
  ["playground", "Playground"],
  ["logs", "Logs"],
  ["settings", "Settings"],
];

function renderBot(bot) {
  const s = bot.status;
  const running = s.state === "online" || s.state === "starting";
  const power = h("button", { class: `btn ${running ? "" : "green"}` }, running ? "■ Stop" : "▶ Start");
  power.onclick = () =>
    busy(power, async () => {
      if (state.dirty) await save();
      await api(`/bots/${bot.id}/${running ? "stop" : "start"}`, { method: "POST", body: {} });
      await refreshBots();
      render();
    });

  const statusLabel = { online: "Online", starting: "Starting…", error: "Error", stopped: "Offline" }[s.state] ?? s.state;

  const header = h(
    "div",
    { class: "bot-header" },
    avatar(bot, "lg"),
    h(
      "div",
      { class: "info" },
      h("h1", {}, bot.spec.name),
      h("div", { class: "row", style: "margin-top:4px" }, h("span", { class: "pill" }, h("span", { class: `dot ${s.state}` }), statusLabel), s.tag && h("span", { class: "muted small" }, s.tag), s.guilds !== undefined && s.state === "online" && h("span", { class: "muted small" }, `${s.guilds} server${s.guilds === 1 ? "" : "s"}`)),
    ),
    bot.inviteUrl && h("a", { class: "btn", href: bot.inviteUrl, target: "_blank", rel: "noopener" }, "➕ Add to server"),
    power,
  );

  const tabs = h(
    "nav",
    { class: "tabs" },
    TABS.map(([key, label]) =>
      h(
        "button",
        {
          class: `tab ${state.tab === key ? "active" : ""}`,
          onclick: () => {
            state.tab = key;
            renderMain();
          },
        },
        label,
      ),
    ),
  );

  const body = { overview: tabOverview, persona: tabPersona, knowledge: tabKnowledge, modules: tabModules, commands: tabCommands, playground: tabPlayground, logs: tabLogs, settings: tabSettings }[state.tab](bot);
  return [header, s.state === "error" && h("div", { class: "notice error", style: "margin-top:16px" }, s.error), tabs, body];
}

function tabOverview(bot) {
  const spec = state.draft;
  const steps = [
    [bot.hasToken, "Add your bot token", h("span", {}, "Create an application at ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "discord.com/developers"), ", open Bot, click Reset Token and paste it in Settings.")],
    [bot.status.state === "online", "Turn on privileged intents", "In the Developer Portal → Bot, enable MESSAGE CONTENT INTENT, and SERVER MEMBERS INTENT if you use Welcome."],
    [Boolean(bot.inviteUrl), "Invite it to your server", "Use the “Add to server” button above."],
    [bot.status.state === "online", "Start the bot", "Press Start. It stays online as long as this dashboard is running."],
  ];

  const instruction = h("textarea", { rows: 3, placeholder: "e.g. Make it speak like a medieval knight and add a /quest command that invents a quest for the user" });
  const apply = h("button", { class: "btn primary" }, "✨ Apply with AI");
  apply.onclick = () =>
    busy(apply, async () => {
      const { spec: updated } = await api("/generate", { method: "POST", body: { description: instruction.value, current: state.draft } });
      state.draft = updated;
      markDirty();
      instruction.value = "";
      toast("Changes drafted. Review them, then save.");
      renderMain();
    });

  return h(
    "div",
    { class: "grid" },
    statsCard(bot),
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Edit with AI"),
      h("p", { class: "muted", style: "margin:6px 0 12px" }, "Describe a change in plain English. Nothing is saved until you press Save."),
      instruction,
      h("div", { class: "row", style: "margin-top:10px" }, apply),
    ),
    h(
      "div",
      { class: "grid two" },
      h(
        "div",
        { class: "card" },
        h("h2", { style: "margin-bottom:12px" }, "Setup"),
        h(
          "ul",
          { class: "checklist" },
          steps.map(([done, title, text]) => h("li", { class: done ? "done" : "" }, h("span", { class: "mark" }, done ? "✓" : ""), h("div", {}, h("div", {}, title), h("div", { class: "muted small" }, text)))),
        ),
      ),
      h(
        "div",
        { class: "card" },
        h("h2", { style: "margin-bottom:12px" }, "What it does"),
        h("p", { class: "muted", style: "margin-top:0" }, spec.description),
        h("div", { class: "chips" }, enabledModules(spec).map((m) => h("span", { class: "pill" }, m.icon, " ", m.title))),
        spec.customCommands.length > 0 && h("p", { class: "small" }, spec.customCommands.map((c) => h("code", { style: "margin-right:6px" }, `/${c.name}`))),
      ),
    ),
  );
}

function statsCard(bot) {
  const card = h("div", { class: "card" }, h("div", { class: "muted small" }, "Loading activity…"));
  api(`/bots/${bot.id}/stats`)
    .then((data) => {
      const t = data.days.at(-1);
      const month = data.days.reduce((n, d) => n + d.cost, 0);
      const money = (n) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
      const tile = (label, value, sub) => h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value" }, value), sub && h("div", { class: "muted small" }, sub));
      card.replaceChildren(
        h("div", { class: "row between" }, h("h2", {}, "Activity"), h("span", { class: "muted small" }, "Today, UTC")),
        h(
          "div",
          { class: "stats" },
          tile("Messages seen", t.messages.toLocaleString()),
          tile("AI replies", t.aiReplies.toLocaleString(), data.dailyLimit ? `of ${data.dailyLimit.toLocaleString()} daily limit` : "no daily limit"),
          tile("Commands used", t.commands.toLocaleString()),
          tile("AI cost today", money(t.cost), `${money(month)} last 30 days`),
        ),
        costChart(data.days),
      );
    })
    .catch(() => card.replaceChildren(h("div", { class: "muted small" }, "Activity unavailable.")));
  return card;
}

// 30 daily bars of estimated AI spend. Single series, so no legend: the title names it.
function costChart(days) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.append(...kids);
    return el;
  };
  const W = 600, H = 120, pad = 18;
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  const step = W / days.length;
  const barW = Math.max(2, step - 2); // 2px gap between bars
  const tip = h("div", { class: "chart-tip", hidden: true });
  const bars = days.map((d, i) => {
    const bh = d.cost > 0 ? Math.max(2, ((H - pad) * d.cost) / max) : 0;
    const x = i * step + 1;
    const g = svg("g", { class: "bar" },
      svg("rect", { x, y: 0, width: step, height: H, fill: "transparent" }), // full-height hit target
      bh ? svg("path", { d: roundedTop(x, H - bh, barW, bh, Math.min(4, barW / 2)), fill: "var(--chart)" }) : svg("rect", { x, y: H - 1, width: barW, height: 1, fill: "var(--line)" }),
    );
    const show = () => {
      tip.hidden = false;
      tip.textContent = `${new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}: $${d.cost.toFixed(3)} · ${d.aiReplies} AI replies`;
      tip.style.left = `${((x + step / 2) / W) * 100}%`;
    };
    g.addEventListener("mouseenter", show);
    g.addEventListener("mouseleave", () => (tip.hidden = true));
    return g;
  });
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "chart", role: "img", "aria-label": "Estimated AI cost per day for the last 30 days" }, ...bars);
  return h(
    "div",
    { class: "chart-wrap" },
    h("div", { class: "row between" }, h("h3", {}, "AI cost per day"), h("span", { class: "muted small" }, `peak $${max.toFixed(2)}`)),
    h("div", { class: "chart-box" }, chart, tip),
    h("div", { class: "row between muted small" }, h("span", {}, "30 days ago"), h("span", {}, "today")),
  );
}

function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function tabPersona() {
  const p = state.draft.persona;
  const models = [
    ["claude-opus-5-5", "Claude Opus 5.5: smartest"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5: balanced"],
    ["claude-haiku-5-5", "Claude Haiku 5.5: fastest, cheapest"],
  ];
  return h(
    "div",
    { class: "card grid" },
    h("div", { class: "grid two" }, field("Name", bindText(state.draft, "name")), field("Status text", bindText(p, "statusText"), "Shown under the bot's name in the member list.")),
    field("Description", bindText(state.draft, "description"), "Shown in /help."),
    field("Personality & instructions", bindText(p, "systemPrompt", { multiline: true, rows: 10 }), "Written to the bot, in second person. This is its whole character."),
    h(
      "div",
      { class: "grid two" },
      field("AI model", bindSelect(p, "model", models)),
      field("Thinking effort", bindSelect(p, "effort", [["low", "Low: quick, casual replies"], ["medium", "Medium: helpful answers"], ["high", "High: careful, expert answers"]])),
    ),
    field("Daily AI reply limit", bindNumber(state.draft, "limits.dailyAiReplies"), "Caps cost. When reached, the bot politely says it's resting until tomorrow. 0 = unlimited."),
    profileSync(),
  );
}

function profileSync() {
  const bot = selected();
  const url = h("input", { type: "text", placeholder: "https://… image URL (optional)" });
  const sync = h("button", { class: "btn" }, "Sync name & avatar to Discord");
  sync.onclick = () =>
    busy(sync, async () => {
      if (state.dirty) await save();
      await api(`/bots/${bot.id}/sync-profile`, { method: "POST", body: { avatarUrl: url.value } });
      await refreshBots();
      render();
      toast("Profile updated on Discord");
    });
  return h(
    "div",
    { class: "subcard grid" },
    h("h3", {}, "Discord profile"),
    h("div", { class: "muted small" }, "Sets the bot account's username to the name above, and its avatar to the image URL. The bot must be running. Discord allows about 2 changes per hour."),
    h("div", { class: "row nowrap" }, url, sync),
  );
}

function tabKnowledge() {
  const k = state.draft.knowledge;
  const LIMIT = 200_000;
  const counter = h("span", { class: "muted small" });
  const toggle = bindSwitch(k, "enabled");
  // Adding material implies the user wants it used.
  const autoEnable = () => {
    if (k.enabled) return;
    k.enabled = true;
    toggle.querySelector("input").checked = true;
  };
  const updateCount = () => {
    const used = k.documents.reduce((n, d) => n + d.content.length, 0);
    counter.textContent = `${used.toLocaleString()} / ${LIMIT.toLocaleString()} characters`;
  };
  updateCount();

  const file = h("input", { type: "file", accept: ".txt,.md,.csv,.json,text/*", multiple: true, style: "display:none" });
  const list = h("div");
  const draw = () =>
    list.replaceChildren(
      repeater(k, "documents", {
        addLabel: "Add document",
        blank: { title: "", content: "" },
        renderItem: (d) => {
          const area = bindText(d, "content", { multiline: true, rows: 8, placeholder: "Paste rules, FAQs, product info, links…" });
          area.addEventListener("input", () => (updateCount(), autoEnable()));
          return [field("Title", bindText(d, "title", { placeholder: "Server rules" })), field("Content", area)];
        },
      }),
    );
  file.onchange = async () => {
    for (const f of file.files) k.documents.push({ title: f.name.replace(/\.[^.]+$/, ""), content: await f.text() });
    k.enabled = true;
    file.value = "";
    markDirty();
    renderMain();
  };
  draw();

  return h(
    "div",
    { class: "card grid" },
    h(
      "div",
      { class: "card-head" },
      h("div", { class: "icon" }, "🧠"),
      h("div", { class: "title" }, h("h3", {}, "Knowledge base"), h("div", { class: "muted small" }, "The bot reads these before every reply and answers from them. It's cached, so a large knowledge base costs about 10% after the first message.")),
      toggle,
    ),
    h("div", { class: "row between" }, counter, h("button", { class: "btn", onclick: () => file.click() }, "⬆ Upload text files"), file),
    list,
  );
}

function tabModules() {
  return h(
    "div",
    {},
    MODULES.map((mod) => {
      const m = state.draft[mod.key];
      const card = h("div", { class: `card ${m.enabled ? "" : "off"}` });
      card.append(
        h(
          "div",
          { class: "card-head" },
          h("div", { class: "icon" }, mod.icon),
          h("div", { class: "title" }, h("h3", {}, mod.title), h("div", { class: "muted small" }, mod.blurb)),
          bindSwitch(m, "enabled", (on) => card.classList.toggle("off", !on)),
        ),
        h("div", { class: "card-body" }, mod.body(m)),
      );
      return card;
    }),
  );
}

const BUILTINS = {
  aiChat: ["ask", "reset"],
  moderation: ["warn", "warnings", "timeout", "purge"],
  leveling: ["rank", "leaderboard"],
  tickets: ["ticket open", "ticket close"],
  giveaways: ["giveaway start", "giveaway end", "giveaway reroll"],
  economy: ["balance", "daily", "work", "pay", "richest"],
  selfRoles: ["selfroles"],
  reminders: ["remind", "reminders"],
};

function tabCommands() {
  const spec = state.draft;
  const builtins = ["help", ...Object.entries(BUILTINS).flatMap(([k, cmds]) => (spec[k].enabled ? cmds : []))];
  return h(
    "div",
    { class: "grid" },
    h(
      "div",
      { class: "card grid" },
      h("div", {}, h("h2", {}, "Custom commands"), h("p", { class: "muted small", style: "margin:4px 0 0" }, "Text commands reply with fixed text. AI commands send your prompt to the bot's brain and reply in persona. Placeholders: {user} {username} {server} {input}")),
      repeater(spec, "customCommands", {
        addLabel: "Add command",
        blank: { name: "", description: "", type: "ai", response: "", takesInput: true, inputDescription: "" },
        renderItem: (c) => [
          h("div", { class: "grid two" }, field("Name", bindText(c, "name", { placeholder: "joke" }), "Lowercase, no spaces."), field("Type", bindSelect(c, "type", [["ai", "AI-generated"], ["text", "Fixed text"]]))),
          field("Description", bindText(c, "description", { placeholder: "Tell a joke" })),
          field("Response / AI prompt", bindText(c, "response", { multiline: true, rows: 2, placeholder: "Tell {username} a short joke about {input}" })),
          toggleRow("Takes input from the user", c, "takesInput"),
          field("Input description", bindText(c, "inputDescription", { placeholder: "Topic" })),
        ],
      }),
    ),
    h("div", { class: "card" }, h("h3", {}, "Built-in commands"), h("p", { class: "small", style: "margin-bottom:0" }, builtins.map((c) => h("code", { style: "margin:0 6px 6px 0;display:inline-block" }, `/${c}`)))),
  );
}

function tabPlayground(bot) {
  const log = h("div", { class: "chat-log" });
  const draw = () => {
    log.replaceChildren(
      ...(state.chat.length ? [] : [h("div", { class: "muted", style: "margin:auto;text-align:center" }, `Chat with ${state.draft.name} using your current (even unsaved) persona. Nothing is posted to Discord.`)]),
      ...state.chat.map((m) => h("div", { class: `msg ${m.role}` }, m.role === "assistant" ? avatar(bot) : null, h("div", { class: "bubble" }, m.content))),
    );
    log.scrollTop = log.scrollHeight;
  };
  const input = h("input", { type: "text", placeholder: "Say something…" });
  const send = h("button", { class: "btn primary", type: "submit" }, "Send");
  const form = h(
    "form",
    {
      onsubmit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        state.chat.push({ role: "user", content: text });
        input.value = "";
        draw();
        busy(send, async () => {
          try {
            const { reply } = await api(`/bots/${bot.id}/test`, { method: "POST", body: { spec: state.draft, messages: state.chat } });
            state.chat.push({ role: "assistant", content: reply });
          } catch (err) {
            state.chat.pop();
            throw err;
          }
          draw();
        });
      },
    },
    input,
    send,
    h("button", { class: "btn", type: "button", onclick: () => ((state.chat = []), draw()) }, "Clear"),
  );
  draw();
  return h("div", { class: "card chat" }, log, form);
}

function tabLogs(bot) {
  const box = h("div", { class: "logs" }, "Loading…");
  const load = async () => {
    const lines = await api(`/bots/${bot.id}/logs`).catch(() => null);
    if (!lines || !box.isConnected) return;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.replaceChildren(...(lines.length ? lines.map((l) => h("div", {}, h("span", { class: "t" }, new Date(l.at).toLocaleTimeString(), "  "), l.line)) : ["No activity yet. Start the bot to see what it's doing."]));
    if (atBottom) box.scrollTop = box.scrollHeight;
  };
  load();
  const timer = setInterval(() => (box.isConnected ? load() : clearInterval(timer)), 3000);
  return box;
}

function duplicateButton(bot) {
  const b = h("button", { class: "btn" }, "⧉ Duplicate bot");
  b.onclick = () =>
    busy(b, async () => {
      const copy = await api(`/bots/${bot.id}/duplicate`, { method: "POST", body: {} });
      await refreshBots();
      selectBot(copy.id);
      toast(`Created ${copy.spec.name}`);
    });
  return b;
}

function tabSettings(bot) {
  const token = h("input", { type: "password", placeholder: bot.hasToken ? "•••••••• saved (paste a new one to replace)" : "Paste bot token", autocomplete: "off" });
  const saveToken = h("button", { class: "btn primary" }, "Save token");
  saveToken.onclick = () =>
    busy(saveToken, async () => {
      if (!token.value.trim()) throw new Error("Paste a token first.");
      await api(`/bots/${bot.id}`, { method: "PUT", body: { token: token.value } });
      token.value = "";
      await refreshBots();
      render();
      toast("Token saved");
    });

  const file = h("input", { type: "file", accept: "application/json", style: "display:none" });
  file.onchange = async () => {
    try {
      const data = JSON.parse(await file.files[0].text());
      state.draft = { ...clone(state.meta.defaults), ...(data.spec ?? data) };
      markDirty();
      renderMain();
      toast("Configuration imported. Review it, then save.");
    } catch {
      toast("That file isn't a valid bot export.", "error");
    }
  };

  const del = h("button", { class: "btn danger" }, "Delete bot");
  del.onclick = () => {
    if (!confirm(`Delete ${bot.spec.name}? Its levels, coins and warnings are deleted too. This can't be undone.`)) return;
    busy(del, async () => {
      await api(`/bots/${bot.id}`, { method: "DELETE" });
      state.dirty = false;
      await refreshBots();
      selectBot("new");
      toast("Bot deleted");
    });
  };

  return h(
    "div",
    { class: "grid" },
    h("div", { class: "card grid" }, h("h2", {}, "Discord token"), field("Bot token", token, "Stored encrypted on this server and never sent back to the browser."), h("div", { class: "row" }, saveToken)),
    h(
      "div",
      { class: "card grid" },
      h("h2", {}, "Backup"),
      h("p", { class: "muted", style: "margin:0" }, "Export the configuration (without the token) or import one."),
      h("div", { class: "row" }, h("a", { class: "btn", href: `/api/bots/${bot.id}/export` }, "⬇ Export JSON"), h("button", { class: "btn", onclick: () => file.click() }, "⬆ Import JSON"), file),
    ),
    h(
      "div",
      { class: "card grid" },
      h("h2", {}, "Own the code"),
      h("p", { class: "muted", style: "margin:0" }, "Download this bot as a standalone Node.js project you can host anywhere, with no dashboard needed. Includes a README and Dockerfile."),
      h("div", { class: "row" }, h("a", { class: "btn primary", href: `/api/bots/${bot.id}/export-code` }, "⬇ Download source code (.zip)"), duplicateButton(bot)),
    ),
    h("div", { class: "card grid" }, h("h2", {}, "Danger zone"), h("div", { class: "row" }, del)),
  );
}

// ---- save bar ------------------------------------------------------------------

async function save() {
  const bot = selected();
  const updated = await api(`/bots/${bot.id}`, { method: "PUT", body: { spec: state.draft } });
  state.draft = clone(updated.spec);
  state.dirty = false;
  await refreshBots();
}

function renderSavebar() {
  document.querySelector(".savebar")?.remove();
  if (!state.dirty || state.view === "new") return;
  const saveBtn = h("button", { class: "btn primary" }, "Save changes");
  saveBtn.onclick = () =>
    busy(saveBtn, async () => {
      await save();
      toast("Saved. A running bot picks up changes right away.");
      render();
    });
  const reset = h(
    "button",
    {
      class: "btn",
      onclick: () => {
        state.draft = clone(selected().spec);
        state.dirty = false;
        render();
      },
    },
    "Reset",
  );
  document.body.append(h("div", { class: "savebar" }, h("span", {}, "You have unsaved changes"), h("div", { class: "row" }, reset, saveBtn)));
}

// ---- top level -----------------------------------------------------------------

function renderMain() {
  const main = document.querySelector("main");
  const bot = selected();
  if (state.view !== "new" && !bot) state.view = "new";
  main.replaceChildren(...(state.view === "new" ? renderNewBot() : renderBot(bot)).filter(Boolean));
  renderSavebar();
}

function render() {
  if (!state.authed) {
    document.querySelector(".savebar")?.remove();
    return renderLogin();
  }
  $app.replaceChildren(h("div", { class: "shell" }, renderSidebar(), h("main")));
  renderMain();
}

async function boot() {
  try {
    state.meta = await api("/meta");
    await refreshBots();
  } catch {
    state.authed = false;
    return render();
  }
  state.authed = true;
  if (state.view === "new" && state.bots.length) state.view = state.bots[0].id;
  state.draft = selected() ? clone(selected().spec) : null;
  render();

  // Keep status dots fresh without clobbering edits in progress.
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.authed) return;
    const before = JSON.stringify(state.bots.map((b) => [b.id, b.status]));
    await refreshBots().catch(() => {});
    if (JSON.stringify(state.bots.map((b) => [b.id, b.status])) !== before) {
      document.querySelector(".sidebar")?.replaceWith(renderSidebar());
      const typing = document.querySelector("main")?.contains(document.activeElement);
      if (!state.dirty && !typing && !["playground", "logs"].includes(state.tab)) renderMain();
    }
  }, 5000);
}

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});

boot();
