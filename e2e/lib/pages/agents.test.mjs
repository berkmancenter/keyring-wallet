// node --test e2e/lib/pages/agents.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

import { fakeAdb, fakeClock, fakeDriver } from "./testing/fakeDriver.mjs";
import { StepError } from "./step.js";
import { agents, answerOwnerCheck, readCommunityCard, readHomeName, readSwitcherRows, splitRows } from "./agents.js";

process.env.E2E_RUN_DIR = mkdtempSync(path.join(os.tmpdir(), "e2e-pages-agents-"));
// driver.js sleeps 500 ms after each swipe: run those on fake timers, ticked by the fake driver's swipes.
mock.timers.enable({ apis: ["setTimeout"] });

/** A linked phone on Your agent: Alpha current, Bravo the other, as chips. */
const home = (name = "Alpha", extra = {}) => ({
  MyAgent: {},
  Contacts: {},
  AgentHome: {},
  AgentHomeName: { text: name },
  AgentChips: { rect: { x: 0, y: 300, width: 1080, height: 120 } },
  AgentSwitcherRow_0: { desc: "Alpha, Current" },
  AgentSwitcherRow_1: { desc: "Bravo, your agent" },
  ...extra,
});
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

test("open: the tab, an introduction skipped where it shows, the home's name", async () => {
  const s = session({ MyAgent: {}, AgentIntro: {}, AgentIntroSkip: {} });
  s.d.onTap.AgentIntroSkip = (d) => d.set(home());
  try {
    const record = await agents.open(s.d, {}, s.opts);
    assert.deepEqual(record.value, { name: "Alpha" });
    assert.equal(record.observed.screen, "AgentHome");
    assert.deepEqual(s.d.taps, ["MyAgent", "AgentIntroSkip"]);
    assert.deepEqual(s.said, ["an agent's introduction is up: Skip"]);
  } finally {
    s.done();
  }
});

test("readSwitcherRows / splitRows / openSwitcher: the chips, the current one told apart", async () => {
  const s = session(home());
  try {
    const rows = await readSwitcherRows(s.d);
    assert.deepEqual(rows, [
      { id: "AgentSwitcherRow_0", desc: "Alpha, Current" },
      { id: "AgentSwitcherRow_1", desc: "Bravo, your agent" },
    ]);
    assert.deepEqual(splitRows(rows), { current: "Alpha, Current", others: [{ id: "AgentSwitcherRow_1", desc: "Bravo, your agent" }] });
    const record = await agents.openSwitcher(s.d, {}, s.opts);
    assert.equal(record.value.length, 2);
    assert.ok(!s.d.taps.includes("AgentSwitcherOpen"), "chips need no opener");
  } finally {
    s.done();
  }
});

test("switchTo: already there taps nothing and says so", async () => {
  const s = session(home("Alpha"));
  try {
    const record = await agents.switchTo(s.d, { name: "Alpha", owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { home: "Alpha", retried: false });
    assert.deepEqual(s.d.taps, ["MyAgent"]);
    assert.deepEqual(s.said, ["already on Alpha"]);
    assert.deepEqual(s.owners, []);
  } finally {
    s.done();
  }
});

test("switchTo: the other row, the owner check, AgentSwitching waited out on the clock, the home renamed", async () => {
  const s = session(home("Alpha"));
  s.d.onTap.AgentSwitcherRow_1 = (d) => {
    d.show("AgentSwitching");
    d.clock.schedule(20000, () => {
      d.hide("AgentSwitching");
      d.show("AgentHomeName", { text: "Bravo" });
      d.show("AgentSwitcherRow_0", { desc: "Alpha, your agent" });
      d.show("AgentSwitcherRow_1", { desc: "Bravo, Current" });
    });
  };
  try {
    const record = await agents.switchTo(s.d, { name: "Bravo", owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { home: "Bravo", retried: false });
    assert.deepEqual(s.owners, ["switch to Bravo"]);
    assert.ok(s.d.taps.includes("AgentSwitcherRow_1"));
    assert.ok(s.said.some((l) => /^switch wait: \d+\.\d s · AgentSwitching seen true$/.test(l)), s.said.join("\n"));
    assert.equal(s.said.at(-1), 'switched: home now "Bravo" (wanted Bravo)');
    assert.ok(s.clock.at() >= 20000);
  } finally {
    s.done();
  }
});

test("switchTo: a dropped row tap is retried by one manual adb tap, with the miss captures, and reported", async () => {
  const s = session(home("Alpha"));
  const adb = (...a) => {
    if (a[0] === "shell" && a[1] === "input") s.d.show("AgentHomeName", { text: "Bravo" });
    return "";
  };
  try {
    const record = await agents.switchTo(s.d, { name: "Bravo", owner: s.owner, adb }, s.opts);
    assert.deepEqual(record.value, { home: "Bravo", retried: true });
    assert.ok(s.said.includes('switch to Bravo did not take (home "Alpha"); retrying once'));
    assert.ok(s.said.includes('after one manual adb tap: home "Bravo"'));
    assert.equal(s.said.at(-1), 'switched: home now "Bravo" (wanted Bravo), after the miss captures');
  } finally {
    s.done();
  }
});

test("switchTo: no row naming the agent is a FINDING line, and the one other row is taken; none is a StepError", async () => {
  const s = session(home("Alpha", { AgentSwitcherRow_1: { desc: "your agent" } }));
  s.d.onTap.AgentSwitcherRow_1 = (d) => d.show("AgentHomeName", { text: "Bravo" });
  const findings = [];
  const orig = console.log;
  console.log = (l) => /^FINDING/.test(String(l)) && findings.push(String(l));
  try {
    const record = await agents.switchTo(s.d, { name: "Bravo", owner: s.owner }, s.opts);
    assert.equal(record.value.home, "Bravo");
    assert.equal(findings.length, 1);
    assert.match(findings[0], /^FINDING switcher has no row naming Bravo: \[/);
    s.d.set(home("Alpha", { AgentSwitcherRow_1: { desc: "Charlie, your agent" }, AgentSwitcherRow_2: { desc: "Delta, your agent" } }));
    await assert.rejects(agents.switchTo(s.d, { name: "Bravo", owner: s.owner }, s.opts), (err) => err instanceof StepError && /no switcher row naming Bravo that is not current/.test(err.message));
  } finally {
    console.log = orig;
    s.done();
  }
});

test("add: the chips' Add, the owner check, the door it opens", async () => {
  const s = session(home("Alpha", { AgentSwitcherAdd: {} }));
  s.d.onTap.AgentSwitcherAdd = (d) => d.set({ VtaLinkByAddress: {}, PasteUrlButton: {} });
  try {
    const record = await agents.add(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { door: "PasteUrlButton" });
    assert.deepEqual(s.owners, ["add agent"]);
  } finally {
    s.done();
  }
});

test("add: Add off the right of the chip strip is swiped into view (239, R9)", async () => {
  const s = session(home("Alpha"));
  s.d.onSwipe = (d) => {
    if (d.swipes >= 4) d.show("AgentSwitcherAdd");
  };
  s.d.onTap.AgentSwitcherAdd = (d) => d.set({ AgentCreateAddressInput: {} });
  try {
    const record = await agents.add(s.d, { owner: s.owner, tag: "add a community's agent (back)" }, s.opts);
    assert.deepEqual(record.value, { door: "AgentCreateAddressInput" });
    assert.ok(s.d.taps.includes("AgentSwitcherAdd"));
  } finally {
    s.done();
  }
});

test("enterAddress: an agent this phone already has is refused with Switch to it, and no code (#350)", async () => {
  const s = session({ VtaLinkByAddress: {} });
  s.d.onTap.VtaLinkByAddress = (d) => d.set({ AgentCreateAddressInput: {}, AgentCreateAddressContinue: {} });
  s.d.onTap.AgentCreateAddressContinue = (d) => d.set({ AgentCreateError: { text: "This phone already has that agent." }, AgentCreateSwitchToExisting: {} });
  try {
    const record = await agents.enterAddress(s.d, { did: "did:web:bravo" }, s.opts);
    assert.deepEqual(record.value, { said: "This phone already has that agent.", code: false, switchToExisting: true });
    assert.equal(s.d.values.AgentCreateAddressInput, "did:web:bravo");
  } finally {
    s.done();
  }
});

test("switchToExisting: Switch to it on the refusal, the owner check, the home renamed (#350)", async () => {
  const s = session({ AgentCreateError: { text: "This phone already has that agent." }, AgentCreateSwitchToExisting: {} });
  s.d.onTap.AgentCreateSwitchToExisting = (d) => {
    d.set({ MyAgent: {}, AgentSwitching: {}, AgentHome: {}, AgentHomeName: { text: "Alpha" } });
    d.clock.schedule(5000, () => d.set({ MyAgent: {}, AgentHome: {}, AgentHomeName: { text: "Bravo" } }));
  };
  try {
    const record = await agents.switchToExisting(s.d, { name: "Bravo", owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { home: "Bravo" });
    assert.deepEqual(s.owners, ["switch to existing"]);
    s.d.set({ AgentCreateError: { text: "x" } });
    await assert.rejects(agents.switchToExisting(s.d, { name: "Bravo" }, s.opts), (err) => err instanceof StepError && /no AgentCreateSwitchToExisting/.test(err.message));
  } finally {
    s.done();
  }
});

test("enterAddress then connect: the code shows, Connect, and a held link's words are read (R11)", async () => {
  const s = session({ AgentCreateAddressInput: {}, AgentCreateAddressContinue: {} });
  s.d.onTap.AgentCreateAddressContinue = (d) => d.set({ AgentCreateOwnerCode: {}, AgentCreateOwnerDid: { text: "did:peer:2.temp" }, AgentCreateConnect: {} });
  s.d.onTap.AgentCreateConnect = (d) => d.clock.schedule(3000, () => d.show("AgentCreateError", { text: "An approver is holding this phone's link." }));
  try {
    const entered = await agents.enterAddress(s.d, { did: "did:web:held" }, s.opts);
    assert.deepEqual(entered.value, { said: "", code: true, switchToExisting: false });
    const connected = await agents.connect(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(connected.value, { ready: false, said: "An approver is holding this phone's link." });
    assert.deepEqual(s.owners, ["connect"]);
  } finally {
    s.done();
  }
});

test("linkTo by the address path: the code granted, Connect, Ready, Done, the introduction skipped, the landing recorded", async () => {
  const s = session({ VtaLinkByAddress: {} });
  const grants = [];
  s.d.onTap.VtaLinkByAddress = (d) => d.set({ AgentCreateAddressInput: {}, AgentCreateAddressContinue: {} });
  s.d.onTap.AgentCreateAddressContinue = (d) => d.set({ AgentCreateOwnerCode: {}, AgentCreateShowCode: {}, AgentCreateConnect: {} });
  s.d.onTap.AgentCreateShowCode = (d) => d.show("AgentCreateOwnerDid", { text: "did:peer:2.\ntemp" });
  s.d.onTap.AgentCreateConnect = (d) => d.clock.schedule(4000, () => d.set({ AgentCreateReady: {}, AgentCreateDone: {} }));
  s.d.onTap.AgentCreateDone = (d) => d.set({ ...home("Bravo"), AgentIntro: {}, AgentIntroSkip: {} });
  s.d.onTap.AgentIntroSkip = (d) => d.hide("AgentIntro", "AgentIntroSkip");
  try {
    const record = await agents.linkTo(s.d, { did: "did:web:bravo", slug: "bravo", owner: s.owner, grant: async (temp, slug) => grants.push([temp, slug]) }, s.opts);
    assert.deepEqual(record.value, { temp: "did:peer:2.temp", path: "address", doneLanding: { intro: true, linkPanel: false } });
    assert.deepEqual(grants, [["did:peer:2.temp", "bravo"]]);
    assert.ok(s.said.includes("link to bravo (address path): the phone shows did:peer:2.temp…; granting"));
    assert.ok(s.said.includes("Done landed: introduction true · link panel false"));
    assert.equal(record.observed.screen, "AgentHome");
  } finally {
    s.done();
  }
});

test("linkTo refuses a call without a grant", async () => {
  const s = session({ VtaLinkByAddress: {} });
  try {
    await assert.rejects(agents.linkTo(s.d, { did: "did:web:bravo", slug: "bravo" }, s.opts), /needs did, slug and grant/);
  } finally {
    s.done();
  }
});

test("keepFirst: the added card's words, Keep, the owner check, back on the home", async () => {
  const s = session(home("Bravo", { AgentAddedCard: { children: ["Bravo was added.", "Keep Alpha as your agent?"] }, AgentAddedKeep: {} }));
  s.d.onTap.AgentAddedKeep = (d) => {
    d.hide("AgentAddedCard", "AgentAddedKeep");
    d.show("AgentHomeName", { text: "Alpha" });
  };
  try {
    const record = await agents.keepFirst(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { card: "Bravo was added. Keep Alpha as your agent?", keepShown: true, keepAtOnce: false });
    assert.deepEqual(s.owners, ["keep"]);
    assert.ok(s.said.includes('R1: added card "Bravo was added. Keep Alpha as your agent? "'));
  } finally {
    s.done();
  }
});

test("keepFirst: no card is said, not failed", async () => {
  const s = session(home("Bravo"));
  try {
    const record = await agents.keepFirst(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { card: "", keepShown: false, keepAtOnce: false });
    assert.ok(s.said.includes("R1: no AgentAddedKeep card after the link (the app went on to the agent)"));
  } finally {
    s.done();
  }
});

test("unlinkOther: on 236's Agent settings screen, the other agent's unlink and its confirm below the fold", async () => {
  const s = session(home("Alpha", { AgentSettings: {} }));
  s.d.onTap.AgentSettings = (d) => d.set({ MyAgent: {}, AgentSettingsScreen: {}, AgentOthers: {}, AgentSwitcherUnlink_b: {}, AgentOtherRow_b: {} });
  s.d.onTap.AgentSwitcherUnlink_b = (d) => d.show("AgentUnlinkOtherCard") || d.show("AgentUnlinkOtherConfirm");
  s.d.onTap.AgentUnlinkOtherConfirm = (d) => d.hide("AgentOtherRow_b", "AgentUnlinkOtherCard", "AgentUnlinkOtherConfirm", "AgentSwitcherUnlink_b");
  s.d.onBack = (d) => d.set(home("Alpha", { AgentSwitcherRow_1: undefined }));  // Bravo unlinked: one chip left
  try {
    const record = await agents.unlinkOther(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { onSettings: true, left: 0 });
    assert.deepEqual(s.owners, ["unlink B"]);
  } finally {
    s.done();
  }
});

test("unlinkOther: no unlink control anywhere is a StepError", async () => {
  const s = session(home("Alpha"));
  try {
    await assert.rejects(agents.unlinkOther(s.d, { owner: s.owner }, s.opts), (err) => err instanceof StepError && /no unlink control for the other agent/.test(err.message));
  } finally {
    s.done();
  }
});

test("unlinkLast: Unlink under the gear, its confirm, the owner check, and the phone offering to link again", async () => {
  const s = session(home("Alpha", { AgentSettings: {} }));
  s.d.onTap.AgentSettings = (d) => d.show("AgentUnlink");
  s.d.onTap.AgentUnlink = (d) => d.show("AgentUnlinkConfirm");
  s.d.onTap.AgentUnlinkConfirm = (d) => d.set({ MyAgent: {}, AgentHomeLink: {} });
  try {
    const record = await agents.unlinkLast(s.d, { owner: s.owner }, s.opts);
    assert.deepEqual(record.value, { linkOffered: true });
    assert.deepEqual(s.owners, ["unlink A"]);
    assert.deepEqual(s.d.taps.filter((t) => t !== "MyAgent"), ["AgentSettings", "AgentUnlink", "AgentUnlinkConfirm"]);
  } finally {
    s.done();
  }
});

test("answerOwnerCheck: the device-credential window gets the PIN and Enter; no window within 8 s is false", async () => {
  const clock = fakeClock();
  const s = session({});
  try {
    const up = fakeAdb({ prompt: () => true });
    assert.equal(await answerOwnerCheck(s.d, "keep", { pin: "1234", adb: up, say: () => undefined, wait: clock.wait }), true);
    assert.deepEqual(up.calls.slice(-2), ["shell input text 1234", "shell input keyevent 66"]);
    const down = fakeAdb({ prompt: () => false });
    assert.equal(await answerOwnerCheck(s.d, "keep", { pin: "1234", adb: down, say: () => undefined, wait: clock.wait }), false);
    assert.equal(down.calls.length, 16);
  } finally {
    s.done();
  }
});

test("readHomeName, readCommunityCard, openCommunityCard: the card's status and Check now, and the door into it", async () => {
  const s = session(home("Alpha", { AgentCommunityCard_k: {}, AgentCommunityStatus_k: { children: ["Your request was turned down."] }, AgentCommunityCheck_k: {}, AgentCommunityOpen_k: {} }));
  s.d.onTap.AgentCommunityOpen_k = (d) => d.set({ CommunityName: { text: "Keyring Lab Community" }, ApplyToCommunityButton: { text: "Choose how to join" } });
  try {
    assert.equal(await readHomeName(s.d), "Alpha");
    assert.deepEqual(await readCommunityCard(s.d, "k"), { card: true, status: "Your request was turned down.", check: true });
    const record = await agents.openCommunityCard(s.d, { key: "k" }, s.opts);
    assert.deepEqual(record.value, { open: "AgentCommunityOpen_k" });
    assert.equal(record.observed.screen, "ApplyToCommunityButton");
  } finally {
    s.done();
  }
});
