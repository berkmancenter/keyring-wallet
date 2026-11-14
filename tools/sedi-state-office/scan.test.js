// node --test tools/sedi-state-office/scan.test.js (kept outside officer/, which the page serves)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { appendScanned } = require("./officer/scan.js");
const { pickCodes } = require("./officer/codes.js");

const HOLDER = "IOXocZLwCoX-VuZciOKV9Iz3Vf9VlYAzWnp08OfZWoXT";
const WARD = "BKWATZ91VtS-SVxiWzxWKK9vF2VRWC59qr3A_BFUsnzV";

test("scanning the guardian's phone, then the ward's, fills both through the paste box's parser", () => {
  let text = "";
  text = appendScanned(text, HOLDER);
  assert.deepEqual(pickCodes(text), { holder: HOLDER, ward: "", holderCount: 1, wardCount: 0 });
  text = appendScanned(text, WARD);
  assert.deepEqual(pickCodes(text), { holder: HOLDER, ward: WARD, holderCount: 1, wardCount: 1 });
});

test("the same QR read again adds nothing (the camera sees it many times a second)", () => {
  const once = appendScanned("", WARD);
  assert.equal(appendScanned(once, WARD), null);
  assert.equal(appendScanned(`${once}\n`, ` ${WARD} `), null);
});

test("a scan goes on its own line after anything already pasted (control: empty box, just the code)", () => {
  assert.equal(appendScanned("from chat: hi  \n", HOLDER), `from chat: hi\n${HOLDER}`);
  assert.equal(appendScanned("", HOLDER), HOLDER);
});

test("an empty read adds nothing", () => {
  assert.equal(appendScanned("x", ""), null);
  assert.equal(appendScanned("x", undefined), null);
});
