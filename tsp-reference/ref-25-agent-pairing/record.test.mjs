// Recording under names: the same value has the same name, different values have different names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recorder } from "./record.mjs";

const KEY_A = "did:key:z6MkiRYFvKF8ACoNWyutekQHkNoxixqiKpxQ1iUixztDb2DM";
const KEY_B = "did:key:z6MknwBvReGXswQd8yhtHhAbRMwhCjkQyvAfGd2MAi9JqLiq";
const KEY_C = "did:key:z6MkgQQEJsRyYc587MdSyVqE8pokFZVMdownfAzLeuoPADW6";

test("a value the case named is written under its name, wherever it appears", () => {
  const record = recorder({ "the agent's key": KEY_A, "first memory": "keyring-memory-abc" });
  assert.deepEqual(record({ subject: KEY_A, act: { contexts: ["keyring-memory-abc"] }, by: KEY_A }), {
    subject: "<the agent's key>",
    act: { contexts: ["<first memory>"] },
    by: "<the agent's key>",
  });
});

test("two answers are recorded equal exactly when they were equal", () => {
  const record = recorder({ "the agent's key": KEY_A });
  const answer = { subject: KEY_A, createdAt: "2026-11-26T08:31:31Z", createdBy: KEY_B };
  assert.deepEqual(record(answer), record({ ...answer }));
  assert.notDeepEqual(record(answer), record({ ...answer, createdAt: "2026-11-26T08:31:32Z" }), "a later time");
  assert.notDeepEqual(record(answer), record({ ...answer, createdBy: KEY_C }), "another key");
  assert.notDeepEqual(record(answer), record({ ...answer, subject: KEY_B }), "the named key replaced by another");
});

test("times and keys nobody named are numbered in the order first seen, and keep their number", () => {
  const record = recorder({});
  assert.deepEqual(record({ a: "2026-11-26T08:31:31Z", b: KEY_B, c: "2026-11-26T08:31:31.931591+00:00" }), { a: "<time 1>", b: "<key 1>", c: "<time 2>" });
  assert.deepEqual(record({ again: KEY_B, first: "2026-11-26T08:31:31Z", other: KEY_C }), { again: "<key 1>", first: "<time 1>", other: "<key 2>" });
});

test("a name with no value is left out, so no other text is ever written under it", () => {
  const record = recorder({ "the device": undefined, "the agent's key": undefined, "nothing": "" });
  assert.deepEqual(record({ keys: { scope: "none" }, approve: { scope: "none" }, note: "undefined" }), { keys: { scope: "none" }, approve: { scope: "none" }, note: "undefined" });
});

test("a value that is part of a longer one is not replaced inside it", () => {
  const record = recorder({ parent: "keyring-memory-abc", child: "keyring-memory-abc/m1" });
  assert.deepEqual(record(["keyring-memory-abc/m1", "keyring-memory-abc"]), ["<child>", "<parent>"]);
  // The order the names are given in does not matter.
  const reversed = recorder({ child: "keyring-memory-abc/m1", parent: "keyring-memory-abc" });
  assert.deepEqual(reversed(["keyring-memory-abc/m1", "keyring-memory-abc"]), ["<child>", "<parent>"]);
});

test("two names for one value are refused, since one of them would never be written", () => {
  assert.throws(() => recorder({ a: KEY_A, b: KEY_A }), /name the same value/);
});

test("nothing is recorded as nothing, and what holds no such value is unchanged", () => {
  const record = recorder({ "the agent's key": KEY_A });
  assert.equal(record(undefined), undefined);
  assert.deepEqual(record({ update: "ok", count: 3, list: [true, null] }), { update: "ok", count: 3, list: [true, null] });
});
