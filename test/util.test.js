import assert from "node:assert/strict";
import { test } from "node:test";
import { fill, levelFromXp, parseDuration, ruleMatches, splitMessage, xpForNextLevel } from "../src/runtime/util.js";

test("splitMessage keeps every part under the limit and loses nothing", () => {
  const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
  const parts = splitMessage(text, 2000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 2000));
  assert.equal(parts.join("\n").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
  assert.deepEqual(splitMessage("short"), ["short"]);
  assert.ok(splitMessage("y".repeat(4500)).every((p) => p.length <= 2000));
});

test("fill replaces known placeholders and leaves unknown ones", () => {
  assert.equal(fill("Hi {user}, welcome to {server} {nope}", { user: "<@1>", server: "Cafe" }), "Hi <@1>, welcome to Cafe {nope}");
});

test("levels follow the 5l²+50l+100 curve", () => {
  assert.equal(xpForNextLevel(0), 100);
  assert.deepEqual(levelFromXp(0), { level: 0, progress: 0, needed: 100 });
  assert.equal(levelFromXp(99).level, 0);
  assert.equal(levelFromXp(100).level, 1);
  assert.equal(levelFromXp(100 + 155).level, 2);
});

test("auto-reply rules match the way the dashboard describes them", () => {
  const rule = (match, trigger) => ({ match, trigger, response: "x", useAI: false });
  assert.ok(ruleMatches(rule("contains", "server ip"), "what's the SERVER IP?"));
  assert.ok(ruleMatches(rule("exact", "hi"), "  Hi "));
  assert.ok(!ruleMatches(rule("exact", "hi"), "hi there"));
  assert.ok(ruleMatches(rule("startsWith", "!rules"), "!rules please"));
  assert.ok(ruleMatches(rule("regex", "^good (morning|night)"), "Good night all"));
  assert.ok(!ruleMatches(rule("regex", "(unclosed"), "anything"));
});

test("parseDuration understands s/m/h/d/w and defaults to minutes", () => {
  assert.equal(parseDuration("30"), 30 * 60_000);
  assert.equal(parseDuration("2h"), 2 * 3_600_000);
  assert.equal(parseDuration("1d"), 86_400_000);
  assert.equal(parseDuration("soon"), null);
});
