// node --test e2e/lib/pages/join.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

import { fakeClock, fakeDriver } from "./testing/fakeDriver.mjs";
import { StepError } from "./step.js";
import { community, communityLink, join, readEntry, readMemberState, readStanding, readWays } from "./join.js";

process.env.E2E_RUN_DIR = mkdtempSync(path.join(os.tmpdir(), "e2e-pages-join-"));
// driver.js sleeps 500 ms after each swipe: run those on fake timers, ticked by the fake driver's swipes.
mock.timers.enable({ apis: ["setTimeout"] });

const session = (screen) => {
  const clock = fakeClock();
  const d = fakeDriver({ screen, clock, tick: (ms) => mock.timers.tick(ms) });
  const said = [];
  const owners = [];
  const opts = { clock, say: (s) => said.push(s) };
  const owner = async (tag) => (owners.push(tag), false);
  const quiet = console.log;
  console.log = () => undefined;
  return { d, clock, said, owners, opts, owner, done: () => (console.log = quiet) };
};
const C = "did:web:lab.example";

test("communityLink: the app's link, its name only when given", () => {
  assert.equal(communityLink(C), "keyring://vti/community?d=did%3Aweb%3Alab.example");
  assert.equal(communityLink(C, "Keyring Lab Community"), "keyring://vti/community?d=did%3Aweb%3Alab.example&n=Keyring%20Lab%20Community");
});

test("openCommunity: the link handed over, a Join screen reached and named", async () => {
  const s = session({ MyAgent: {} });
  const opened = [];
  const open = async (d, link) => {
    opened.push(link);
    d.clock.schedule(3000, () => d.set({ JoinScroll: {}, JoinWays: {}, JoinAsk: {} }));
  };
  try {
    const record = await join.openCommunity(s.d, { did: C, name: "Lab", open }, s.opts);
    assert.deepEqual(record.value, { screen: "JoinWays" });
    assert.deepEqual(opened, [communityLink(C, "Lab")]);
    s.d.set({ Contacts: {} });
    await assert.rejects(join.openCommunity(s.d, { did: C, open: async () => undefined, timeoutMs: 5000 }, s.opts), (err) => err instanceof StepError && /no join screen is showing/.test(err.message));
  } finally {
    s.done();
  }
});

test("ask: Join again first when offered, the ask, the identity step continued, the owner check; beforeTap runs before the tap", async () => {
  const s = session({ JoinScroll: {}, JoinStanding: {}, JoinStandingAgain: {}, JoinAgain: {} });
  const order = [];
  s.d.onTap.JoinAgain = (d) => (order.push("again"), d.set({ JoinScroll: {}, JoinWays: {}, JoinAsk: {} }));
  s.d.onTap.JoinAsk = (d) => (order.push("ask"), d.set({ JoinScroll: {}, JoinMakeIdentity: {}, JoinAsContinue: {} }));
  s.d.onTap.JoinAsContinue = (d) => d.set({ JoinScroll: {}, JoinStanding: {}, JoinStandingText: { text: "You asked to join." } });
  try {
    const record = await join.ask(s.d, { owner: s.owner, tag: "R2 on A", beforeTap: async () => order.push("before") }, s.opts);
    assert.deepEqual(record.value, { askId: "JoinAsk", again: true });
    assert.deepEqual(order, ["again", "before", "ask"]);
    assert.deepEqual(s.owners, ["R2 on A identity"]);
    assert.equal(record.observed.screen, "JoinStanding");
  } finally {
    s.done();
  }
});

test("ask: an older build's Start is the ask when there is no JoinAsk", async () => {
  const s = session({ JoinScroll: {}, JoinAsks: {}, JoinStart: {} });
  s.d.onTap.JoinStart = (d) => d.set({ JoinScroll: {}, JoinStanding: {} });
  try {
    const record = await join.ask(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { askId: "JoinStart", again: false });
  } finally {
    s.done();
  }
});

test("awaitSent: the standing within the deadline; past it, stuck where it was — or reported when not required", async () => {
  const s = session({ JoinScroll: {}, JoinMakeIdentity: {} });
  s.clock.schedule(5000, () => s.d.set({ JoinScroll: {}, JoinStanding: {} }));
  try {
    assert.deepEqual((await join.awaitSent(s.d, { timeoutMs: 60000 }, s.opts)).value, { shown: "standing" });
    s.d.set({ JoinScroll: {}, JoinMakeIdentity: {}, JoinError: { text: "Your agent didn't answer." } });
    await assert.rejects(join.awaitSent(s.d, { timeoutMs: 30000 }, s.opts), (err) => {
      assert.ok(err instanceof StepError);
      assert.equal(err.message, 'join.awaitSent: stuck at "JoinMakeIdentity" for 30 s, waiting for JoinStanding');
      assert.equal(err.record.observed.error, "Your agent didn't answer.");
      return true;
    });
    const late = await join.awaitSent(s.d, { timeoutMs: 120000, required: false }, s.opts);
    assert.deepEqual(late.value, { shown: "no standing in 120 s" });
    assert.equal(late.observed.secondsOnScreen, 120);
  } finally {
    s.done();
  }
});

test("readStanding / readEntry: the waiting screen's lines, and how Join lets this phone in", async () => {
  const s = session({
    JoinScroll: {},
    JoinStanding: {},
    JoinStandingIdentityName: { text: " quiet-river-owl " },
    JoinRequestSent: { text: "Request sent" },
    JoinWillShow: {},
    JoinStandingText: { text: "You asked to join." },
  });
  try {
    assert.deepEqual(await readStanding(s.d), { identityName: "quiet-river-owl", requestSent: true, requestSentText: "Request sent", willShow: true, standingText: "You asked to join.", error: null });
    s.d.set({ JoinScroll: {}, JoinWays: {}, JoinAsk: {} });
    assert.deepEqual(await readEntry(s.d), { chooser: false, wayIn: true, standing: null });
  } finally {
    s.done();
  }
});

test("awaitLost: Check again once after 30 s, then the lost-request screen and its words", async () => {
  const s = session({ JoinScroll: {}, JoinStanding: {}, JoinStandingText: { text: "You asked to join." }, JoinCheckAgain: {} });
  s.d.onTap.JoinCheckAgain = (d) => d.clock.schedule(2000, () => d.set({ JoinScroll: {}, JoinRequestLost: { text: "Your request didn't reach the community." }, JoinSendAgain: {} }));
  try {
    const record = await join.awaitLost(s.d, { timeoutMs: 10000, checkAgainAfterMs: 2000 }, s.opts);
    assert.deepEqual(record.value, { lost: true, words: "Your request didn't reach the community.", checked: true, standingText: null });
    assert.deepEqual(s.said, ["Join still waiting after 2 s: Check again"]);
    assert.equal(record.observed.screen, "JoinRequestLost");
  } finally {
    s.done();
  }
});

test("awaitLost: not lost by the deadline is reported with the standing, not failed", async () => {
  const s = session({ JoinScroll: {}, JoinStanding: {}, JoinStandingText: { text: "You asked to join." } });
  try {
    const record = await join.awaitLost(s.d, { timeoutMs: 4000, checkAgainAfterMs: 2000 }, s.opts);
    assert.deepEqual(record.value, { lost: false, words: "", checked: false, standingText: "You asked to join." });
    assert.ok(s.clock.at() >= 4000);
  } finally {
    s.done();
  }
});

test("sendAgain: the fresh request's identity step continued; no Send again is a StepError", async () => {
  const s = session({ JoinScroll: {}, JoinRequestLost: {}, JoinSendAgain: {} });
  s.d.onTap.JoinSendAgain = (d) => d.set({ JoinScroll: {}, JoinMakeIdentity: {}, JoinAsContinue: {} });
  s.d.onTap.JoinAsContinue = (d) => d.set({ JoinScroll: {}, JoinStanding: {} });
  try {
    const record = await join.sendAgain(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { continued: true });
    assert.deepEqual(s.owners, ["send again identity"]);
    s.d.set({ JoinScroll: {}, JoinStanding: {} });
    await assert.rejects(join.sendAgain(s.d, {}, s.opts), (err) => err instanceof StepError && /no JoinSendAgain/.test(err.message));
  } finally {
    s.done();
  }
});

test("readMemberState / done / scanOtherCommunity: a member's Join, its Done to the highlighted card, its scanner", async () => {
  const member = { JoinScroll: {}, JoinMemberCheck: {}, JoinDone: {}, JoinOpenCommunity: {}, JoinScanCommunity: {} };
  const s = session(member);
  s.d.onTap.JoinScanCommunity = (d) => d.set({ PasteUrlButton: {} });
  s.d.onBack = (d) => d.set(member);
  s.d.onTap.JoinDone = (d) => d.set({ AgentHome: {}, AgentCommunityHighlighted: {} });
  try {
    assert.deepEqual(await readMemberState(s.d), { check: true, done: true, open: true });
    const scan = await join.scanOtherCommunity(s.d, {}, s.opts);
    assert.deepEqual(scan.value, { offered: true, scanner: true });
    assert.equal(s.d.backs, 1);
    const done = await join.done(s.d, {}, s.opts);
    assert.deepEqual(done.value, { lit: true });
    assert.equal(done.observed.screen, "AgentHome");
  } finally {
    s.done();
  }
});

test("readWays / startWay: the ways-in card, and Meet a vetter leading to Get vetted", async () => {
  const s = session({ JoinScroll: {}, JoinWays: {}, JoinWaysTitle: { text: "Ways in" }, JoinWay_vet: {}, JoinWayFollows_vet: { text: "One vetter must confirm who you are" }, JoinWayStart_vet: { text: "Meet a vetter" } });
  s.d.onTap.JoinWayStart_vet = (d) => d.set({ VettingApplicantStep_ticket: {} });
  try {
    const ways = await readWays(s.d, ["vet", "review"]);
    assert.equal(ways.ways, true);
    assert.deepEqual(ways.byWay.vet, { row: true, follows: "One vetter must confirm who you are", start: "Meet a vetter" });
    assert.deepEqual(ways.byWay.review, { row: false, follows: null, start: null });
    const record = await join.startWay(s.d, { way: "vet", owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { landed: "VettingApplicantStep_" });
    assert.deepEqual(s.owners, ["way vet"]);
  } finally {
    s.done();
  }
});

test("community.chooseHowToJoin: the button's words and the Join screen it leads to (#326)", async () => {
  const s = session({ CommunityScroll: {}, CommunityName: { text: "Lab" }, ApplyToCommunityButton: { text: "Choose how to join" } });
  s.d.onTap.ApplyToCommunityButton = (d) => d.set({ JoinScroll: {}, JoinWays: {} });
  try {
    const record = await community.chooseHowToJoin(s.d, {}, s.opts);
    assert.deepEqual(record.value, { words: "Choose how to join", landed: "JoinWays" });
  } finally {
    s.done();
  }
});

test("community.readHolding / useHolderAgent: held by another agent (#320), then switched to it", async () => {
  const s = session({ CommunityScroll: {}, CommunityHeldElsewhere: {}, CommunityHeldElsewhereText: { children: ["On Alpha", "Use Alpha to open it"] }, CommunityUseHolderAgent: {} });
  s.d.onTap.CommunityUseHolderAgent = (d) => {
    d.set({ AgentSwitching: {}, AgentHome: {}, AgentHomeName: { text: "Bravo" } });
    d.clock.schedule(2000, () => d.set({ AgentHome: {}, AgentHomeName: { text: "Alpha" } }));
  };
  try {
    const held = await community.readHolding(s.d, {}, s.opts);
    assert.deepEqual(held.value, { held: true, heldText: "On Alpha Use Alpha to open it", useHolder: true, leave: false });
    const used = await community.useHolderAgent(s.d, { name: "Alpha", owner: s.owner, tag: "R7 use A" }, s.opts);
    assert.deepEqual(used.value, { heldGone: true });
    assert.deepEqual(s.owners, ["R7 use A"]);
    assert.ok(s.said.some((l) => /^switch wait: .* AgentSwitching seen true$/.test(l)));
  } finally {
    s.done();
  }
});
