// The pure parts of this week's tester-fix rows (241): run-wrong-pin.mjs (IN-257), run-signin-unjoined.mjs (IN-249)
// and run-card-status.mjs (IN-258). The drivers run their flow only when started directly, so importing them here
// opens nothing. Run: node --test e2e/lib/testerFixRows.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDriver } from "./pages/testing/fakeDriver.mjs";
import { pinCount, readPinField, wrongPinFor } from "../run-wrong-pin.mjs";
import { fromOf, labelForm, readsAsDid, signInLink, triggerId } from "../run-signin-unjoined.mjs";
import { cardStatusOutcome, noticeIn, statusHostOf, statusListHostIn, TRACKED } from "../run-card-status.mjs";

// ------------------------------------------------------------------ IN-257

test("a wrong PIN is never the right one, and keeps its length", () => {
  for (const pin of ["123456", "999999", "000000", "908172"]) {
    const wrong = wrongPinFor(pin);
    assert.equal(wrong.length, pin.length);
    for (let i = 0; i < pin.length; i++) assert.notEqual(wrong[i], pin[i]);
  }
  assert.equal(wrongPinFor("123456"), "234567");
  assert.equal(wrongPinFor("999999"), "000000");
});

test("pinCount counts masked bullets and digits, never the spaces between them", () => {
  assert.equal(pinCount("● ● ● ● ● ●"), 6);
  assert.equal(pinCount("1 2 3"), 3);
  assert.equal(pinCount(""), 0);
  assert.equal(pinCount(null), 0);
  assert.equal(pinCount(undefined), 0);
  // iOS can answer an empty field with its accessibility words: no digit, no bullet.
  assert.equal(pinCount("Masked"), 0);
});

test("readPinField reads Android's text and iOS's value", async () => {
  const android = fakeDriver({ platform: "android", screen: { EnterPIN: { text: "● ● ● ● ● ●" } } });
  assert.deepEqual(await readPinField(android), { raw: "● ● ● ● ● ●", count: 6 });
  android.show("EnterPIN", { text: "" });
  assert.deepEqual(await readPinField(android), { raw: "", count: 0 });

  const ios = fakeDriver({ platform: "ios", screen: { EnterPIN: {} } });
  ios.values.EnterPIN = "● ● ●";
  assert.equal((await readPinField(ios)).count, 3);
  ios.values.EnterPIN = "";
  assert.equal((await readPinField(ios)).count, 0);
});

test("readPinField on a screen without the field reads nothing rather than throwing", async () => {
  const d = fakeDriver({ platform: "android", screen: {} });
  assert.equal((await readPinField(d)).count, 0);
});

// ------------------------------------------------------------------ IN-249

const DID = "did:webvh:QmExampleScid1234:webvh.example.org%3A8443:test-vtc";

test("signInLink makes a trigger link the reader accepts: host, handle, expiry, flow", () => {
  const now = 1_800_000_000;
  const link = signInLink({ did: DID, now, id: triggerId(Buffer.alloc(16, 7)) });
  const url = new URL(link);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "link.trustoverip.org");
  assert.equal(url.search, "");
  assert.doesNotMatch(link, /[\s\u0000-\u001f\u007f]/);
  assert.equal(link.split("#").length, 2);
  const f = new URLSearchParams(link.slice(link.indexOf("#") + 1));
  // The fragment's form decoding gives back the DID exactly, its %3A included.
  assert.equal(f.get("_from"), DID);
  assert.match(f.get("_id"), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(Number(f.get("_exp")), now + 600);
  assert.equal(f.get("_type"), "/vti/flow/sign-in/0.1");
  assert.equal(fromOf(link), DID);
});

test("triggerId is canonical unpadded base64url of 16 bytes (its last character's low 4 bits are zero)", () => {
  const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < 50; i++) {
    const id = triggerId();
    assert.equal(id.length, 22);
    assert.equal(B64URL.indexOf(id[21]) & 0b1111, 0);
  }
});

test("signInLink refuses no DID; fromOf reads nothing from a link without a fragment", () => {
  assert.throws(() => signInLink({}), /needs did/);
  assert.equal(fromOf("https://link.trustoverip.org/"), undefined);
  assert.equal(fromOf(undefined), undefined);
});

test("a community label that is, or holds, the DID reads as a DID", () => {
  assert.equal(readsAsDid(DID, DID), true);
  assert.equal(readsAsDid("  did:webvh:Qm…:test-vtc", DID), true);
  assert.equal(readsAsDid(`Community ${DID}`, DID), true);
  assert.equal(readsAsDid("Keyring Lab Community", DID), false);
  assert.equal(readsAsDid("test-vtc (no name published yet)", DID), false);
});

test("labelForm says which form the label took", () => {
  assert.equal(labelForm("Keyring Lab Community", "Keyring Lab Community"), "its name");
  assert.equal(labelForm("test-vtc (no name published yet)", "Keyring Lab Community"), "its handle, unnamed");
  assert.equal(labelForm("Something else", "Keyring Lab Community"), "other words");
  assert.equal(labelForm("", "x"), "empty");
});

// ------------------------------------------------------------------ IN-258

test("the status-list host: the override, else C_REST's host", () => {
  assert.equal(statusHostOf("https://vtc.example.org/v1", ""), "vtc.example.org");
  assert.equal(statusHostOf("https://vtc.example.org/v1", " lists.example.org "), "lists.example.org");
  assert.equal(statusHostOf("not a url", undefined), "");
  assert.equal(statusHostOf(undefined, undefined), "");
});

test("statusListHostIn finds the card's status list host in an admin answer", () => {
  const said = '[ref-20] decide -> 200\n{"credential":{"credentialStatus":{"statusListCredential": "https://vtc.example.org/v1/status-lists/revocation","statusListIndex":"7"}}}';
  assert.equal(statusListHostIn(said), "vtc.example.org");
  assert.equal(statusListHostIn('{"status":"approved"}'), "");
  assert.equal(statusListHostIn(undefined), "");
});

test("noticeIn finds the notice's words or a testID naming it, and nothing on an ordinary card", () => {
  const android = (text, id = "AgentCommunityStatus_x") => `<node resource-id="com.ariesbifold:id/${id}" text="${text}" content-desc=""/>`;
  assert.match(noticeIn(android("We couldn't check this card's status. Try again")), /couldn't check this card's status/);
  assert.match(noticeIn(android("Couldn’t check the status of your card")), /status/);
  assert.match(noticeIn(android("Its status could not be checked right now")), /could not be checked/);
  assert.equal(noticeIn(`<XCUIElementTypeOther name="com.ariesbifold:id/CardStatusUnreadable" label=""/>`), "testID CardStatusUnreadable");
  assert.equal(noticeIn(android("You're a member of Keyring Lab Community.")), "");
  assert.equal(noticeIn(android("Waiting for Keyring Lab Community to answer")), "");
  // "couldn't check" about something else, with no status in reach, is not the notice.
  assert.equal(noticeIn(android("We couldn't check for updates")), "");
  assert.equal(noticeIn(undefined), "");
});

test("the row is tracked: SKIP without the notice, PASS with it, FAIL only when strict", () => {
  assert.deepEqual(cardStatusOutcome({ notice: "couldn't check (Your agent)", observed: "card status \"x\"" }), {
    status: "PASS",
    detail: 'notice "couldn\'t check (Your agent)"; card status "x"',
  });
  const tracked = cardStatusOutcome({ notice: "", observed: 'card status "Approved"' });
  assert.equal(tracked.status, "SKIP");
  assert.equal(tracked.detail, `${TRACKED}; observed: card status "Approved"`);
  assert.match(tracked.detail, /^tracked: IN-258 fix pending; observed: /);
  assert.equal(cardStatusOutcome({ notice: "", observed: "o", strict: true }).status, "FAIL");
  // A setup that never reached the check is SKIP whatever `strict` says.
  const setup = cardStatusOutcome({ setup: "no new pending request", strict: true });
  assert.equal(setup.status, "SKIP");
  assert.match(setup.detail, /^tracked: IN-258 fix pending; setup did not reach the check: no new pending request$/);
});
