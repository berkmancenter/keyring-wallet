// node --test tools/sedi-state-office/codes.test.js (kept outside officer/, which the page serves)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pickCodes } = require("./officer/codes.js");

// Literal codes of each shape (from the 11-14 K1 test: Alberto's guardian code, Brendan's ward code).
const HOLDER = "IOXocZLwCoX-VuZciOKV9Iz3Vf9VlYAzWnp08OfZWoXT";
const WARD = "BKWATZ91VtS-SVxiWzxWKK9vF2VRWC59qr3A_BFUsnzV";
const WARD_P256 = "1AAI" + "A".repeat(44);
const HOLDER_E = "E" + "b".repeat(43);

test("the shapes these rows assume", () => {
  assert.equal(HOLDER.length, 44);
  assert.equal(WARD.length, 44);
  assert.equal(WARD_P256.length, 48);
});

test("two pasted messages, codes inside sentences, either order: both found", () => {
  const text = `Ward code: ${WARD}\n\nhere's mine (guardian) -> ${HOLDER}.`;
  assert.deepEqual(pickCodes(text), { holder: HOLDER, ward: WARD, holderCount: 1, wardCount: 1 });
});

test("an E guardian code and a 1AAI ward code are taken too", () => {
  const r = pickCodes(`${WARD_P256} ${HOLDER_E}`);
  assert.equal(r.holder, HOLDER_E);
  assert.equal(r.ward, WARD_P256);
});

test("only one code: the other is left empty, never guessed", () => {
  assert.deepEqual(pickCodes(WARD), { holder: "", ward: WARD, holderCount: 0, wardCount: 1 });
  assert.deepEqual(pickCodes(HOLDER), { holder: HOLDER, ward: "", holderCount: 1, wardCount: 0 });
});

test("the same code twice counts once (control: two different ones are ambiguous and left empty)", () => {
  assert.equal(pickCodes(`${WARD} ${WARD}`).ward, WARD);
  const two = pickCodes(`${WARD} B${"c".repeat(43)}`);
  assert.equal(two.ward, "");
  assert.equal(two.wardCount, 2);
});

test("near misses are not codes: a char short or long, a wrong first letter, a code glued to more text", () => {
  for (const t of [HOLDER.slice(0, 43), HOLDER + "x", "D" + HOLDER.slice(1), WARD + "Z", "x" + WARD])
    assert.deepEqual(pickCodes(t), { holder: "", ward: "", holderCount: 0, wardCount: 0 }, t);
});

test("nothing pasted, or not text: nothing found", () => {
  assert.deepEqual(pickCodes(""), { holder: "", ward: "", holderCount: 0, wardCount: 0 });
  assert.deepEqual(pickCodes(undefined), { holder: "", ward: "", holderCount: 0, wardCount: 0 });
});
