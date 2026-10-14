// node --test e2e/lib/pages/link.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { LINK_SCREENS, StepError, createLinkPage, screenIn } from "./link.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "com.ariesbifold:id/";

/**
 * A phone as the page sees it: a set of ids on screen, their words, what a
 * tap does, and a clock that moves only when the code waits. Every helper the
 * page calls records what it did.
 */
function fakePhone({ platform = "android" } = {}) {
  const screen = new Set();
  const text = {};
  const onTap = {};
  const calls = [];
  const shots = [];
  const logs = [];
  const timed = [];
  let onPaste;
  let clip = "";
  let t = 0;
  const tick = (ms) => {
    t += ms;
    for (const e of timed) {
      if (!e.done && e.at <= t) {
        e.done = true;
        e.fn();
      }
    }
  };
  const has = (k) => screen.has(k);
  const el = (key) => ({
    isExisting: async () => has(key),
    click: async () => {
      calls.push(`click ${key}`);
      await onTap[key]?.();
    },
    getAttribute: async () => text[key] ?? "",
    getText: async () => text[key] ?? "",
    setValue: async (v) => calls.push(`type ${key}=${v}`),
    getLocation: async () => ({ x: 0, y: 0 }),
    getSize: async () => ({ width: 100, height: 100 }),
  });
  const d = {
    e2ePlatform: platform,
    getPageSource: async () => [...screen].map((k) => `<android.view.View resource-id="${PREFIX}${k}" text="${text[k] ?? ""}" bounds="[0,0][10,10]"/>`).join("\n"),
    getClipboard: async () => clip,
    getWindowRect: async () => ({ width: 400, height: 800 }),
  };
  const io = {
    byTestId: (_d, key) => el(key),
    existsTestId: async (_d, key, timeout = 4000) => {
      calls.push(`exists ${key}`);
      if (has(key)) return true;
      tick(timeout);
      return has(key);
    },
    waitForTestId: async (_d, key, timeout = 30000) => {
      if (!has(key)) tick(timeout);
      if (!has(key)) throw new Error(`element testID=${key} not found in ${timeout}ms`);
      return el(key);
    },
    tapTestId: async (_d, key, timeout = 30000) => {
      const e = await io.waitForTestId(_d, key, timeout);
      calls.push(`tap ${key}`);
      await onTap[key]?.();
      return e;
    },
    scrollToTestId: async (_d, key) => {
      calls.push(`scroll ${key}`);
      if (has(key)) return el(key);
      throw new Error(`testID=${key} not displayed`);
    },
    screenshot: async (_d, tag) => {
      shots.push(tag);
      return `${tag}.png`;
    },
    dumpSource: async (_d, tag) => `${tag}.xml`,
    sleep: async (ms) => tick(ms),
    deviceTag: () => `${platform}:fake`,
    dismissTourIfPresent: async () => calls.push("dismissTour"),
    passNewPhoneOfferIfShown: async () => {
      calls.push("passOffer");
      return false;
    },
    pasteLinkOnScanScreen: async (_d, url) => {
      calls.push(`paste ${url}`);
      await onPaste?.(url);
    },
    clearNotices: async () => false,
    pageSource: (dd) => dd.getPageSource(),
    clipboard: (dd) => dd.getClipboard(),
    windowRect: (dd) => dd.getWindowRect(),
    swipe: async () => {
      calls.push("swipe");
      await onTap.swipe?.();
    },
    now: () => t,
    log: (s) => logs.push(s),
  };
  const show = (...keys) => keys.forEach((k) => screen.add(k));
  const hide = (...keys) => keys.forEach((k) => screen.delete(k));
  return {
    d,
    io,
    calls,
    shots,
    logs,
    text,
    onTap,
    show,
    hide,
    say: (key, words) => {
      show(key);
      text[key] = words;
    },
    at: (ms, fn) => timed.push({ at: ms, fn }),
    onPaste: (fn) => (onPaste = fn),
    clipboard: (v) => (clip = Buffer.from(v, "utf8").toString("base64")),
    now: () => t,
  };
}

const page = (phone, opts) => createLinkPage(phone.d, { io: phone.io, ...opts });

test("pasteCode: the host's code lands on the confirm screen, recorded by its id", async () => {
  const p = fakePhone();
  p.show("PasteUrlButton");
  p.onPaste(() => {
    p.hide("PasteUrlButton");
    p.show("VtaLinkConfirm", "VtaLinkButton");
  });
  const r = await page(p).pasteCode("keyring://vti/link?o=abc");
  assert.equal(r.ok, true);
  assert.equal(r.step, "pasteCode");
  assert.equal(r.role, "link");
  assert.equal(r.observed.stepId, "VtaLinkConfirm");
  assert.ok(p.calls.includes("paste keyring://vti/link?o=abc"));
});

test("pasteCode: a scanner that never leaves fails by name, with a screenshot and where it sat for how long", async () => {
  const p = fakePhone();
  p.show("PasteUrlButton");
  await assert.rejects(page(p).pasteCode("keyring://x"), (err) => {
    assert.ok(err instanceof StepError);
    assert.match(err.message, /^link\.pasteCode: stuck at "PasteUrlButton" for 3\d s, waiting for VtaLinkConfirm$/);
    assert.equal(err.record.ok, false);
    assert.equal(err.record.step, "pasteCode");
    assert.equal(err.record.screenshot, "step-link-pasteCode-android.png");
    assert.equal(err.record.source, "step-link-pasteCode-android.xml");
    assert.equal(err.record.observed.stepId, "PasteUrlButton");
    assert.ok(err.record.observed.secondsOnStep >= 30);
    return true;
  });
  assert.deepEqual(p.shots, ["step-link-pasteCode-android"]);
  assert.ok(p.logs.some((l) => l.startsWith("[step] link.pasteCode FAILED — stuck at")));
});

test("awaitStep: with none of the link's screens showing, the record says so and names the last one seen", async () => {
  const p = fakePhone();
  p.show("VtaLinkConfirm");
  p.at(4000, () => p.hide("VtaLinkConfirm"));
  await assert.rejects(page(p).awaitCode({ timeoutMs: 10000 }), /link\.awaitCode: none of the link's screens is showing \(last seen: VtaLinkConfirm at .*; waiting for VtaLinkCode\)/);
});

test("awaitCode: the code arrives later, read without its VoiceOver spaces", async () => {
  const p = fakePhone({ platform: "ios" });
  p.show("VtaLinkConfirm");
  p.at(5000, () => p.say("VtaLinkCode", "1234 5678"));
  const r = await page(p).awaitCode();
  assert.equal(r.value, "12345678");
  assert.ok(p.now() >= 5000);
  assert.equal(r.platform, "ios");
});

test("awaitLinked: Check again is tapped while waiting, and Linked ends it", async () => {
  const p = fakePhone();
  p.show("VtaLinkForOtherPhone", "VtaLinkWaitingForPhone");
  p.at(3000, () => {
    p.hide("VtaLinkWaitingForPhone");
    p.show("VtaLinkCheckAgain");
  });
  p.onTap.VtaLinkCheckAgain = () => {
    p.hide("VtaLinkCheckAgain");
    p.show("VtaLinkDone", "VtaLinkLinkedBody");
  };
  const r = await page(p).awaitLinked();
  assert.deepEqual(r.value, { state: "done", said: "", detail: "" });
  assert.ok(p.calls.includes("tap VtaLinkCheckAgain"));
  assert.equal(r.observed.stepId, "VtaLinkDone");
});

test("awaitLinked: a refusal comes back with its words and the text behind Details, not as a throw", async () => {
  const p = fakePhone();
  p.show("VtaLinkForOtherPhone");
  p.at(2000, () => {
    p.say("VtaLinkError", "This code is  for a community's agent. ");
    p.show("VtaLinkErrorDetailsToggle");
  });
  p.onTap.VtaLinkErrorDetailsToggle = () => p.say("VtaLinkErrorDetail", "VtaClient: refused");
  const r = await page(p).awaitLinked({ timeoutMs: 120000 });
  assert.deepEqual(r.value, { state: "error", said: "This code is for a community's agent.", detail: "VtaClient: refused" });
  assert.ok(p.calls.includes("click VtaLinkErrorDetailsToggle"));
  // The refusal shares the screen with the card that led there: the record names the refusal.
  assert.equal(r.observed.stepId, "VtaLinkError");
});

test("awaitLinked: details: false leaves the refusal's Details closed", async () => {
  const p = fakePhone();
  p.say("VtaLinkError", "refused");
  p.show("VtaLinkErrorDetailsToggle");
  const r = await page(p).awaitLinked({ timeoutMs: 30000, details: false });
  assert.deepEqual(r.value, { state: "error", said: "refused", detail: "" });
  assert.ok(!p.calls.includes("click VtaLinkErrorDetailsToggle"));
});

test("awaitLinked: neither Linked nor a refusal: stuck at the state the screen sat on, for how long", async () => {
  const p = fakePhone();
  p.show("VtaLinkForOtherPhone", "VtaLinkWaitingForPhone");
  await assert.rejects(page(p).awaitLinked({ timeoutMs: 240000, checkAgain: false }), (err) => {
    assert.match(err.message, /^link\.awaitLinked: stuck at "VtaLinkForOtherPhone" for 24\d s, waiting for VtaLinkDone \| VtaLinkError$/);
    assert.equal(err.record.observed.lastStepSeen, "VtaLinkForOtherPhone");
    return true;
  });
});

test("readKey: Show as text on the scan card, then the key as text", async () => {
  const p = fakePhone();
  p.show("VtaLinkForOtherPhone", "VtaLinkShowAsText", "VtaLinkCopyKey");
  p.onTap.VtaLinkShowAsText = () => p.say("VtaLinkManualDid", "did:key:z6Mk\nabc def");
  const r = await page(p).readKey();
  assert.deepEqual(r.value, { did: "did:key:z6Mkabcdef", by: "text" });
  assert.ok(!p.calls.includes("click VtaLinkCopyKey"));
});

test("readKey: no text for it: Copy and the clipboard (239's resumed link)", async () => {
  const p = fakePhone();
  p.show("VtaLinkResumed", "VtaLinkCopyKey", "VtaLinkShareKey");
  p.clipboard("Your phone's key: did:key:z6MkCopied — add it to the agent");
  const r = await page(p).readKey();
  assert.deepEqual(r.value, { did: "did:key:z6MkCopied", by: "copy" });
  assert.ok(p.calls.includes("click VtaLinkCopyKey"));
});

test("readKey: nothing to read fails by name, or records an empty key when a case asks", async () => {
  const p = fakePhone();
  p.show("VtaLinkConfirm");
  await assert.rejects(page(p).readKey(), /link\.readKey: .*VtaLinkCopyKey not found/);
  const r = await page(p).readKey({ required: false });
  assert.deepEqual(r.value, { did: "", by: "copy" });
  assert.equal(r.ok, true);
});

test("awaitNotYet: not yet below the fold is found by scrolling; didn't answer gets the one retry a person makes", async () => {
  const p = fakePhone();
  p.show("VtaLinkManualDid", "VtaLinkCheckGrant", "VtaLinkNoAnswer");
  p.onTap.VtaLinkCheckGrant = () => {
    p.hide("VtaLinkNoAnswer");
    p.at(p.now() + 3000, () => p.show("VtaLinkNotYet"));
  };
  const r = await page(p).awaitNotYet({ retryNoAnswer: true });
  assert.deepEqual(r.value, { retried: true });
  assert.equal(p.calls.filter((c) => c === "tap VtaLinkCheckGrant").length, 1);
  assert.deepEqual(p.shots, ["link-no-answer-first"]);
  assert.ok(p.logs.some((l) => l.startsWith("[e2e] second check settled: not yet")));
});

test("awaitNotYet: without the retry, didn't answer is waited past and the step fails by name", async () => {
  const p = fakePhone();
  p.show("VtaLinkManualDid", "VtaLinkCheckGrant", "VtaLinkNoAnswer");
  await assert.rejects(page(p).awaitNotYet(), (err) => {
    assert.match(err.message, /^link\.awaitNotYet: android: the phone never said the key was not added yet$/);
    assert.equal(err.record.observed.noAnswer, true);
    assert.equal(err.record.observed.stepId, "VtaLinkNoAnswer");
    return true;
  });
  assert.ok(!p.calls.includes("tap VtaLinkCheckGrant"));
  assert.ok(p.now() >= 60000);
});

test("introduction: the offer, three pages, the home; the centre measure is handed out before the pages turn", async () => {
  const p = fakePhone();
  p.show("AgentIntro", "AgentIntroNext");
  let taps = 0;
  const seen = [];
  p.onTap.AgentIntroNext = () => {
    if (++taps === 3) {
      p.hide("AgentIntro", "AgentIntroNext");
      p.show("AgentHome", "AgentHomeName");
    }
  };
  const r = await page(p).introduction({ onCentre: (c) => seen.push([c, taps]) });
  assert.deepEqual(seen, [[undefined, 0]]); // no AgentIntroButtons on this build: nothing to measure, and measured before any page turned
  assert.equal(r.observed.stepId, "AgentHome");
  assert.equal(r.value.offerKept, false);
  assert.ok(p.calls.includes("passOffer"));
  assert.deepEqual(p.shots, ["link-06-intro"]);
});

test("introduction: pages that never reach the home are the failure, by the screen that stayed", async () => {
  const p = fakePhone();
  p.show("AgentIntro", "AgentIntroNext");
  await assert.rejects(page(p).introduction({ offer: false }), /link\.introduction: stuck at "AgentIntro" for 3\d s, waiting for AgentHome$/);
  assert.equal(p.calls.filter((c) => c === "tap AgentIntroNext").length, 3);
});

test("open: Link again (the agent no longer accepts this phone) is taken before Scan your agent's code", async () => {
  const p = fakePhone();
  p.show("MyAgent", "VtaLinkScanAgain", "LinkYourAgentButton");
  p.onTap.VtaLinkScanAgain = () => p.show("PasteUrlButton");
  const r = await page(p).open();
  assert.deepEqual(r.value, { entry: "VtaLinkScanAgain" });
  assert.deepEqual(p.calls.slice(0, 3), ["dismissTour", "click MyAgent", "exists VtaLinkScanAgain"]);
  assert.ok(!p.calls.includes("tap LinkYourAgentButton"));
});

test("open: the scanner that never opens is the failure", async () => {
  const p = fakePhone();
  p.show("MyAgent", "LinkYourAgentButton");
  await assert.rejects(page(p).open(), /link\.open: stuck at "LinkYourAgentButton" for 1\d s, waiting for PasteUrlButton \| Continue$/);
});

test("pasteAddress: the agent's bare address opens the scan card", async () => {
  const p = fakePhone();
  p.show("PasteUrlButton");
  p.onPaste(() => p.show("VtaLinkForOtherPhone", "VtaLinkWaitingForPhone"));
  const r = await page(p).pasteAddress("did:web:bob.example");
  assert.equal(r.observed.stepId, "VtaLinkForOtherPhone");
  assert.ok(p.calls.includes("paste did:web:bob.example"));
});

test("resume: Continue linking opens the resumed link with the kept key", async () => {
  const p = fakePhone();
  p.show("MyAgent", "MyAgentContinueLink");
  p.onTap.MyAgentContinueLink = () => p.show("VtaLinkResumed", "VtaLinkShowTheCode");
  const r = await page(p).resume();
  assert.deepEqual(r.value, { continueLink: true, resumed: true, on: "VtaLinkResumed" });
  const q = fakePhone();
  q.show("AgentHome");
  const s = await page(q).resume({ waitMs: 15000, required: false });
  assert.deepEqual(s.value, { continueLink: false, resumed: false, on: null });
  await assert.rejects(page(q).resume({ waitMs: 15000 }), /link\.resume: stuck at "AgentHome" for 2\d s/);
});

test("enterAddress: the code step, or a refusal on the address step as its words", async () => {
  const p = fakePhone();
  p.show("AgentCreateAddressInput", "AgentCreateAddressContinue");
  p.onTap.AgentCreateAddressContinue = () => p.say("AgentCreateError", "To protect your agent, turn on a passcode first.");
  const r = await page(p).enterAddress("did:web:bob");
  assert.deepEqual(r.value, { state: "error", said: "To protect your agent, turn on a passcode first.", detail: "", needsLock: true });
  assert.ok(p.calls.includes("type AgentCreateAddressInput=did:web:bob"));
  const q = fakePhone();
  q.show("AgentCreateAddressInput", "AgentCreateAddressContinue");
  q.onTap.AgentCreateAddressContinue = () => q.show("AgentCreateOwnerCode", "AgentCreateShowCode");
  assert.equal((await page(q).enterAddress("did:web:bob")).value.state, "code");
});

test("showCode, awaitReady, done: the address path's code, its end, and the way to the agent", async () => {
  const p = fakePhone();
  p.show("AgentCreateOwnerCode", "AgentCreateShowCode", "AgentCreateAsDevice");
  p.onTap.AgentCreateShowCode = () => p.say("AgentCreateOwnerDid", "did:key:z6Mk Owner");
  const code = await page(p).showCode();
  assert.deepEqual(code.value, { did: "did:key:z6MkOwner", asDevice: true });
  p.show("AgentCreateWaiting", "AgentCreateCheckAgain");
  p.onTap.AgentCreateCheckAgain = () => p.show("AgentCreateReady", "AgentCreateDone");
  const end = await page(p).awaitReady();
  assert.equal(end.value.state, "ready");
  assert.ok(p.calls.includes("tap AgentCreateCheckAgain"));
  p.onTap.AgentCreateDone = () => {
    p.hide("AgentCreateReady", "AgentCreateDone", "AgentCreateOwnerCode", "AgentCreateWaiting", "AgentCreateCheckAgain", "AgentCreateShowCode", "AgentCreateOwnerDid", "AgentCreateAsDevice");
    p.show("AgentIntro");
  };
  assert.equal((await page(p).done()).observed.stepId, "AgentIntro");
  const q = fakePhone();
  q.show("AgentCreateWaiting", "AgentCreateCheckAgain");
  const none = await page(q).awaitReady({ timeoutMs: 10000, checkAgain: false, required: false });
  assert.equal(none.value.state, "none");
  assert.ok(!q.calls.includes("tap AgentCreateCheckAgain"));
  await assert.rejects(page(q).awaitReady({ timeoutMs: 10000 }), /stuck at "AgentCreateWaiting" for 1\d s, waiting for AgentCreateReady \| AgentCreateError/);
});

test("keepCard: the new agent's introduction is skipped, the added card's Keep tapped", async () => {
  const p = fakePhone();
  p.show("AgentIntro", "AgentIntroSkip");
  p.onTap.AgentIntroSkip = () => {
    p.hide("AgentIntro", "AgentIntroSkip");
    p.at(p.now() + 2000, () => p.show("AgentHome", "AgentAddedCard", "AgentAddedKeep"));
  };
  const r = await page(p).keepCard();
  assert.deepEqual(r.value, { shown: true });
  assert.ok(p.calls.includes("tap AgentIntroSkip"));
  assert.ok(p.calls.includes("click AgentAddedKeep"));
  const q = fakePhone();
  q.show("AgentHome");
  assert.deepEqual((await page(q).keepCard({ timeoutMs: 5000 })).value, { shown: false });
  await assert.rejects(page(q).keepCard({ timeoutMs: 5000, required: true }), /link\.keepCard: no Keep card \(AgentAddedKeep\) showed/);
});

test("addAgent: the chips' Add, swiped into view when off the strip, opens a way in", async () => {
  const p = fakePhone();
  p.show("AgentHome", "AgentChips");
  p.onTap.swipe = () => p.show("AgentSwitcherAdd");
  p.onTap.AgentSwitcherAdd = () => p.show("PasteUrlButton");
  const r = await page(p).addAgent();
  assert.deepEqual(r.value, { on: "PasteUrlButton" });
  assert.ok(p.calls.includes("swipe"));
  assert.ok(p.calls.includes("click AgentSwitcherAdd"));
});

test("typeAddressOnLink and showTheCode (240 and before): the address, the give-key hint checked, the toggle tapped, the key", async () => {
  const p = fakePhone();
  p.show("VtaLinkAgentAddress");
  const typed = await page(p).typeAddressOnLink("did:web:bob");
  assert.deepEqual(typed.value, { knewAgent: false });
  assert.ok(p.calls.includes("type VtaLinkAgentAddress=did:web:bob\n"));
  // The toggle is below the fold: one swipe brings it into the tree.
  p.onTap.swipe = () => p.show("VtaLinkShowTheCode", "VtaLinkGiveKeyHow");
  p.onTap.VtaLinkShowTheCode = () => p.say("VtaLinkManualDid", "did:peer:2.Ez6");
  const key = await page(p).showTheCode();
  assert.deepEqual(key.value, { did: "did:peer:2.Ez6", tapped: ["VtaLinkShowTheCode"] });
  assert.ok(p.logs.includes("[e2e] give-key: how the admin adds it is in view before the code"));
});

test("showTheCode: the give-key screen that hides how the admin adds the code is the failure (keyring-bifold#107)", async () => {
  const p = fakePhone();
  p.show("VtaLinkAgentAddress", "VtaLinkShowTheCode");
  await assert.rejects(page(p).showTheCode(), /link\.showTheCode: the give-key screen hides how the admin adds the code/);
  assert.deepEqual(p.shots, ["link-give-key-how-hidden", "step-link-showTheCode-android"]);
});

test("records go to the log file as one JSON line each, ok and failed alike", async () => {
  const p = fakePhone();
  p.show("VtaLinkConfirm", "VtaLinkButton");
  const log = path.join(mkdtempSync(path.join(tmpdir(), "link-steps-")), "steps.jsonl");
  const link = page(p, { log });
  await link.pressLink();
  await assert.rejects(link.awaitCode({ timeoutMs: 4000 }));
  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.role, l.step, l.ok]), [["link", "pressLink", true], ["link", "awaitCode", false]]);
  // Polled every 2 s: the deadline of 4 s is seen passed on the poll at 6 s.
  assert.equal(lines[1].error, 'stuck at "VtaLinkConfirm" for 6 s, waiting for VtaLinkCode');
});

test("screenIn: the first of the link's screens in the page source, by its full id", () => {
  assert.equal(screenIn(`<a name="${PREFIX}AgentHome"/><b name="${PREFIX}AgentIntro"/>`), "AgentIntro");
  assert.equal(screenIn(`<a name="${PREFIX}VtaLinkDoneX"/>`), null);
  assert.equal(screenIn(""), null);
});

test("every id the page names is in the app's manifest, or allowlisted with a reason", () => {
  const lib = path.resolve(here, "..");
  const load = (f) => JSON.parse(readFileSync(path.join(lib, f), "utf8"));
  const known = new Set();
  for (const f of ["testids.json", "testids.app.json"]) {
    const m = load(f);
    for (const k of Object.keys(m.keys ?? {})) known.add(k);
    for (const k of Object.keys(m.raw ?? {})) known.add(k);
  }
  const allowed = load("testids.allow.json");
  // The code only: a comment's "Linked" is a word, not an id.
  const src = readFileSync(path.join(here, "link.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const named = new Set([...LINK_SCREENS, ...[...src.matchAll(/"((?:VtaLink|Agent|MyAgent|Link|PasteUrl|NewPhoneOffer|EnterPIN|Continue)[A-Za-z]*)"/g)].map((m) => m[1])]);
  const unknown = [...named].filter((id) => !known.has(id) && !Object.hasOwn(allowed, id));
  assert.deepEqual(unknown, [], `unknown ids in link.js: ${unknown.join(", ")}`);
  assert.ok(named.size > 40, `only ${named.size} ids found in link.js`);
});
