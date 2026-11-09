import { test } from "node:test";
import assert from "node:assert/strict";
import { typeExact } from "./typeExact.js";

const DID = "did:webvh:QmeMs2tPuTyoaiARygznuS8eoFBVc16BAww5GpTXp7SMWU:dids.ic3.dev:keyring-runner-mini-hvvetter-vta";
/** A field whose whole-string setValue moves the second character to the end for its first `bad` calls (10-22's race). */
function field({ bad = 0, attr = "value" } = {}) {
  let v = ""; let n = 0;
  return {
    calls: [],
    async clearValue() { v = ""; this.calls.push("clear"); },
    async setValue(t) { this.calls.push("set"); n++; v = n <= bad ? t[0] + t.slice(2) + t[1] : t; },
    async addValue(ch) { this.calls.push("add"); v += ch; },
    async getAttribute(a) { return a === attr ? v : null; },
  };
}
const wait = async () => {};

test("a field that takes the text first time: one try", async () => {
  assert.deepEqual(await typeExact(field(), DID, { platform: "ios", wait }), { tries: 1, verified: true });
});

test("the 10-22 race once: read back, cleared and typed again", async () => {
  const f = field({ bad: 1 });
  assert.deepEqual(await typeExact(f, DID, { platform: "ios", wait }), { tries: 2, verified: true });
  assert.equal(f.calls.filter((c) => c === "set").length, 2);
});

test("the race on every whole-string try: the last try goes a character at a time", async () => {
  const f = field({ bad: 99 });
  assert.deepEqual(await typeExact(f, DID, { platform: "ios", wait }), { tries: 3, verified: true });
  assert.equal(f.calls.filter((c) => c === "add").length, DID.length);
});

test("Android reads the text attribute", async () => {
  assert.deepEqual(await typeExact(field({ attr: "text" }), DID, { platform: "android", wait }), { tries: 1, verified: true });
});

test("a field that never holds the text: a driver error, not an app verdict", async () => {
  const stuck = { async clearValue() {}, async setValue() {}, async addValue() {}, async getAttribute() { return "di:webvh:x"; } };
  await assert.rejects(typeExact(stuck, DID, { platform: "ios", wait }), (e) => /^driver: the field holds "di:webvh:x"/.test(e.message) && e.observed.got === "di:webvh:x");
});

test("an element that cannot be read back (a page test's fake) is typed once, unverified", async () => {
  const typed = []; const fake = { async setValue(t) { typed.push(t); } };
  assert.deepEqual(await typeExact(fake, DID, { platform: "ios", wait }), { tries: 1, verified: false });
  assert.deepEqual(typed, [DID]);
});
