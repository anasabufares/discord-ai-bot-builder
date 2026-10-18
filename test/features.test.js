import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";
import { GatewayIntentBits } from "discord.js";
import { costOf } from "../src/ai.js";
import { intentsFor } from "../src/runtime/bot.js";
import { KNOWLEDGE_LIMIT, normalizeSpec } from "../src/schema.js";
import { dayStats, recordUsage } from "../src/store.js";
import { TEMPLATES } from "../src/templates.js";
import { createZip } from "../src/zip.js";

test("zip entries can be read back", () => {
  const zip = createZip([{ name: "dir/hello.txt", data: "hello world" }, { name: "b.json", data: "{}" }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLen = zip.readUInt16LE(26);
  const size = zip.readUInt32LE(18);
  assert.equal(zip.subarray(30, 30 + nameLen).toString(), "dir/hello.txt");
  assert.equal(zlib.inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + size)).toString(), "hello world");
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 2);
});

test("every template is a valid spec with a unique id", () => {
  assert.ok(TEMPLATES.length >= 6);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) assert.deepEqual(normalizeSpec(t.spec), t.spec);
});

test("cost estimate covers tokens, cache and web searches", () => {
  assert.equal(costOf("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(costOf("claude-haiku-5-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } }), 0.03);
  assert.ok(costOf("claude-sonnet-5-5", { cache_read_input_tokens: 1e6 }) < costOf("claude-sonnet-5-5", { input_tokens: 1e6 }));
});

test("knowledge is capped and empty documents dropped", () => {
  const big = "x".repeat(KNOWLEDGE_LIMIT);
  const spec = normalizeSpec({ knowledge: { enabled: true, documents: [{ title: "", content: big }, { title: "b", content: "more" }, { title: "c", content: "  " }] } });
  assert.equal(spec.knowledge.documents.length, 1);
  assert.equal(spec.knowledge.documents[0].title, "Untitled");
  assert.equal(spec.knowledge.documents[0].content.length, KNOWLEDGE_LIMIT);
});

test("self-role panels keep at most 25 buttons and drop empty roles", () => {
  const roles = Array.from({ length: 30 }, (_, i) => ({ role: `r${i}`, label: "", emoji: "" }));
  const spec = normalizeSpec({ selfRoles: { enabled: true, panels: [{ title: "", description: "", roles: [...roles, { role: " ", label: "x", emoji: "" }] }] } });
  assert.equal(spec.selfRoles.panels[0].roles.length, 25);
  assert.equal(spec.selfRoles.panels[0].roles[0].label, "r0");
  assert.equal(spec.selfRoles.panels[0].title, "Pick your roles");
});

test("intents follow enabled modules", () => {
  const minimal = normalizeSpec({ aiChat: { enabled: false } });
  assert.deepEqual(intentsFor(minimal), [GatewayIntentBits.Guilds]);
  const star = intentsFor(normalizeSpec({ aiChat: { enabled: false }, starboard: { enabled: true } }));
  assert.ok(star.includes(GatewayIntentBits.GuildMessageReactions) && star.includes(GatewayIntentBits.MessageContent));
  const log = intentsFor(normalizeSpec({ aiChat: { enabled: false }, logging: { enabled: true, messageDeletes: false, messageEdits: false } }));
  assert.ok(log.includes(GatewayIntentBits.GuildMembers) && !log.includes(GatewayIntentBits.MessageContent));
});

test("usage accumulates into today's stats", () => {
  const file = { data: {}, save() {} };
  recordUsage(file, { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 1000, output_tokens: 20 }, 0.5);
  recordUsage(file, { input_tokens: 1, output_tokens: 1 }, 0.25);
  const s = dayStats(file);
  assert.equal(s.inputTokens, 151);
  assert.equal(s.cachedTokens, 1000);
  assert.equal(s.outputTokens, 21);
  assert.equal(s.cost, 0.75);
});
