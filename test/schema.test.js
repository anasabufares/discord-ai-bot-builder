import assert from "node:assert/strict";
import { test } from "node:test";
import { createCipher, createSessions } from "../src/crypto.js";
import { clientIdFromToken } from "../src/manager.js";
import { DEFAULT_SPEC, normalizeSpec } from "../src/schema.js";

test("normalizeSpec fills defaults for a partial spec", () => {
  const spec = normalizeSpec({ name: "Pirate", economy: { enabled: true } });
  assert.equal(spec.name, "Pirate");
  assert.equal(spec.economy.enabled, true);
  assert.equal(spec.economy.dailyAmount, DEFAULT_SPEC.economy.dailyAmount);
  assert.deepEqual(spec.persona, DEFAULT_SPEC.persona);
});

test("normalizeSpec clamps numbers and fixes command names", () => {
  const cmd = (name) => ({ name, description: "", type: "text", response: "ok", takesInput: false, inputDescription: "" });
  const spec = normalizeSpec({
    aiChat: { historyLength: 9999, cooldownSeconds: -5 },
    leveling: { xpMin: 50, xpMax: 10 },
    customCommands: [cmd("Roll Dice!"), cmd("roll-dice"), cmd("ask"), cmd("")],
  });
  assert.equal(spec.aiChat.historyLength, 50);
  assert.equal(spec.aiChat.cooldownSeconds, 0);
  assert.ok(spec.leveling.xpMax >= spec.leveling.xpMin);
  assert.deepEqual(spec.customCommands.map((c) => c.name), ["roll-dice"]);
});

test("normalizeSpec rejects wrong types", () => {
  assert.throws(() => normalizeSpec({ persona: { model: "gpt-4" } }));
  assert.throws(() => normalizeSpec({ moderation: { bannedWords: "bad" } }));
});

test("tokens round-trip through encryption and fail with the wrong key", () => {
  const a = createCipher("a".repeat(40));
  const enc = a.encrypt("secret-token");
  assert.notEqual(enc, "secret-token");
  assert.equal(a.decrypt(enc), "secret-token");
  assert.throws(() => createCipher("b".repeat(40)).decrypt(enc));
});

test("sessions verify only untampered, unexpired tokens", () => {
  const s = createSessions("k".repeat(40));
  const t = s.issue();
  assert.ok(s.verify(t));
  assert.ok(!s.verify(`${t}x`));
  assert.ok(!createSessions("j".repeat(40)).verify(t));
  assert.ok(!createSessions("k".repeat(40), -1000).verify(createSessions("k".repeat(40), -1000).issue()));
  assert.ok(!s.verify(undefined));
});

test("clientIdFromToken reads the bot id out of a token", () => {
  const id = "123456789012345678";
  assert.equal(clientIdFromToken(`${Buffer.from(id).toString("base64")}.abc.def`), id);
  assert.equal(clientIdFromToken("not-a-token"), null);
});
