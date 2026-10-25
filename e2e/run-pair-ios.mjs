#!/usr/bin/env node
/**
 * Two iOS simulators, A and B, both freshly onboarded (the leg installs the build on each):
 *
 * Share link (bifold #453; iOS; Android unproven: #453 ran iOS only, and the Android link's fingerprints are not checked
 * against the release key):
 *   pair-share-link-made      A shows the code, taps "Share as a link" (MyQRShareLink) and copies from the system share
 *                             sheet: the link (read with simctl pbpaste) is a different invitation from the code
 *   pair-share-link-connects  A leaves the code screen; B opens the link through iOS (simctl openurl, as a tapped link);
 *                             the relationship exchange completes and each lists the other (the VRC gate check)
 *
 * Emoji picker (bifold #574; rich messaging Step 2, W2). Each side reads the other's change from its own screen:
 *   pair-react-picker         B sends A a message; A long-presses it, opens the full picker from the reaction bar's
 *                             "+", searches "cat" and chooses 🐱: B's message shows "🐱 1" on B
 *   pair-react-same           B chooses 🐱 from the picker on the same message: both read "🐱 2, including you"
 *   pair-react-remove         A chooses 🐱 again from the picker, which removes A's reaction: B reads
 *                             "🐱 1, including you" and A reads "🐱 1"
 *   pair-emoji-composer       A types text, adds 😀 from the composer's emoji button and sends: B shows the text with
 *                             the emoji
 *
 * Message-wake tap (bifold #452; tap path only: the mediator wake isn't exercised. The webhook lives only on the shared
 * mediator, which a gate build must not use; the real wake is proven on real phones by the post-build device check):
 *   pair-wake-opens-chat      B sends A a message while A is in the background; a wake-shaped notification (the push
 *                             gateway's KEYRING_WAKE alert with a keyring-msg- thread id, AppDelegate.mm) is delivered
 *                             to A with simctl push and tapped: the Messages list shows at once, then B's chat opens
 *                             ("message wake: chat")
 *   pair-wake-no-unread-list  the same tap with nothing unread: A stays on the Messages list ("message wake: list")
 *
 *   A_UDID=… A_NAME=… B_UDID=… B_NAME=… APPIUM_PORT=4776 node run-pair-ios.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptSystemAlertIfPresent, byTestId, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { acceptRelationshipProposalOnEitherSide, assertVrcReceived, completeOnboarding, dismissTourIfPresent, openQrSheet, returnToContacts, unlockIfLocked } from "./lib/flows.js";
import { appLogged } from "./lib/appLog.js";
import { createRows } from "./lib/rows.js";
import { deviceLog, keepAlive, openDevice } from "./openvtc/hvDevices.js";

const APP = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
const A = { udid: process.env.A_UDID, name: process.env.A_NAME, first: "Alice", last: "Anderson", wda: 8141, mjpeg: 9141 };
const B = { udid: process.env.B_UDID, name: process.env.B_NAME, first: "Bob", last: "Baker", wda: 8142, mjpeg: 9142 };
// The wake needs A and B related: B writes to A from its chat.
const rows = createRows({
  label: "pair-ios",
  needs: {
    "pair-share-link-connects": ["pair-share-link-made"],
    "pair-react-picker": ["pair-share-link-connects"],
    "pair-react-same": ["pair-react-picker"],
    "pair-react-remove": ["pair-react-same"],
    "pair-emoji-composer": ["pair-share-link-connects"],
    "pair-wake-opens-chat": ["pair-share-link-connects"],
    "pair-wake-no-unread-list": ["pair-wake-opens-chat"],
  },
});
// Off when the build names no push gateway: no notification permission, so no banner to tap (pair-ios.sh).
const WAKE_NOT_RUN = process.env.PAIR_WAKE === "off" ? "NOT RUN (no push permission in gate builds): #452 rests on its unit and real-navigator tests and the device check" : undefined;
const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8", timeout: 60000 });

/** The message-wake outcomes the app logged since `sinceMs` ("message wake: chat|list|moved", TabStack.tsx). */
const wakeOutcomes = (udid, sinceMs) => [...deviceLog({ platform: "ios", udid }, sinceMs).matchAll(/message wake: (chat|list|moved)/g)].map((m) => m[1]);

/** Deliver a wake-shaped notification to A and tap its banner from the home screen. */
async function pushAndTapWake(d, udid, tag) {
  const dir = mkdtempSync(path.join(tmpdir(), "wake-"));
  const file = path.join(dir, "wake.json");
  writeFileSync(file, JSON.stringify({ aps: { alert: { "loc-key": "KEYRING_WAKE" }, "thread-id": `keyring-msg-gate-${tag}` } }));
  await d.execute("mobile: pressButton", { name: "home" });
  await sleep(1500);
  simctl("push", udid, APP, file);
  // The banner belongs to SpringBoard; its label names the app.
  await d.execute("mobile: activateApp", { bundleId: "com.apple.springboard" });
  const banner = await d.$('-ios predicate string:label CONTAINS[c] "Keyring" AND visible == 1 AND (type == "XCUIElementTypeButton" OR type == "XCUIElementTypeOther" OR type == "XCUIElementTypeCell")');
  await banner.waitForExist({ timeout: 15000 }).catch(() => undefined);
  if (!(await banner.isExisting())) throw new Error("driver: the wake's banner did not show on the simulator");
  await banner.click();
  await sleep(2000);
}

/** On `peer`'s chat: the composer is up and the header names them. */
async function onChat(d, peer) {
  const composer = await d.$("-ios class chain:**/XCUIElementTypeTextView").isExisting();
  const named = await d.$(`-ios predicate string:label CONTAINS "${peer.first} ${peer.last}" AND visible == 1`).isExisting();
  return composer && named;
}

/** Send `text` from the open chat. The composer has no testID (gifted-chat; MessageInput.tsx): found by type. */
async function sendChat(d, text) {
  const input = await d.$("-ios class chain:**/XCUIElementTypeTextView");
  await input.waitForExist({ timeout: 15000 });
  await input.setValue(text);
  const send = await d.$("~GC_SEND_TOUCHABLE"); // gifted-chat Send.js
  await send.click();
  await sleep(2000);
}

/** From the Contacts list, open `peer`'s chat. */
async function openChatWith(d, peer) {
  await returnToContacts(d);
  await (await d.$(`-ios predicate string:label CONTAINS "${peer.first} ${peer.last}" AND visible == 1`)).click();
  for (const until = Date.now() + 15000; Date.now() < until; await sleep(1000)) if (await onChat(d, peer)) return;
  throw new Error(`driver: ${peer.first}'s chat did not open`);
}

/** A message bubble's text, waited for: a received message arrives through the mediator. */
async function waitForText(d, text, timeout = 60000) {
  const el = await d.$(`-ios predicate string:label CONTAINS "${text}" AND visible == 1`);
  await el.waitForExist({ timeout }).catch(() => undefined);
  return (await el.isExisting()) ? el : undefined;
}

/** Long-press a message (the actions sheet, ChatIds.actions), then "+" on its reaction bar for the full picker. */
async function openReactionPicker(d, text) {
  const bubble = await waitForText(d, text, 15000);
  if (!bubble) throw new Error(`driver: no message "${text}" to react to`);
  await d.execute("mobile: touchAndHold", { elementId: bubble.elementId, duration: 1.2 });
  await tapTestId(d, "ChatReactionBarMore", 10000);
  if (!(await existsTestId(d, "EmojiPickerSheet", 10000))) throw new Error("driver: the reaction bar's + did not open the picker");
}

/** In the open picker: search, then choose by code points (EmojiPicker.ids.ts's EmojiPickerEmoji_<code points>). */
async function chooseEmoji(d, query, codePoints) {
  await (await byTestId(d, "EmojiPickerSearch")).setValue(query);
  await tapTestId(d, `EmojiPickerEmoji_${codePoints}`, 10000);
}

/**
 * The reactions under the one reacted message, as its accessibility label reads (ChatMessage.tsx's MessageReactions:
 * "🐱 2, including you"), polled until it says `want` or the time is up. Returns what it last read.
 */
async function reactionsReach(d, want, timeout = 60000) {
  let got = "";
  for (const until = Date.now() + timeout; Date.now() < until; await sleep(2000)) {
    got = (await existsTestId(d, "ChatMessageReactions", 1000)) ? ((await byTestId(d, "ChatMessageReactions").getAttribute("label")) ?? "") : "";
    if (got === want) break;
  }
  return got;
}

let a, b;
try {
  for (const [k, v] of Object.entries({ A_UDID: A.udid, B_UDID: B.udid })) if (!v) throw new Error(`driver: ${k} is required`);
  await ensureAppium();
  a = await openDevice({ platform: "ios", udid: A.udid, deviceName: A.name, wdaPort: A.wda, mjpegPort: A.mjpeg });
  b = await openDevice({ platform: "ios", udid: B.udid, deviceName: B.name, wdaPort: B.wda, mjpegPort: B.mjpeg });
  rows.setDriver(a);
  const stop = keepAlive(a, b);
  try {
    await Promise.all([completeOnboarding(a, { firstName: A.first, lastName: A.last }), completeOnboarding(b, { firstName: B.first, lastName: B.last })]);

    // Share link.
    let link;
    await rows.row("pair-share-link-made", async () => {
      const since = Date.now();
      await unlockIfLocked(a);
      await dismissTourIfPresent(a);
      await openQrSheet(a);
      await tapTestId(a, "GenerateRelationshipQRCode", 15000);
      // A fresh install meets the camera disclosure first ("Allow camera use"): Continue, then the system alert, as
      // showRelationshipInvitation does (the 1021-0158 RC gate stopped here).
      if (await existsTestId(a, "Continue", 5000)) {
        await tapTestId(a, "Continue");
        await acceptSystemAlertIfPresent(a);
      }
      await existsTestId(a, "MyQRShareLink", 20000);
      await scrollToTestId(a, "MyQRShareLink", 4).catch(() => undefined);
      // The code's own invitation is readable only in a dev build (InvitationUrl, __DEV__); a release build says so.
      const codeEl = (await existsTestId(a, "InvitationUrl", 5000)) ? await a.$("~InvitationUrl") : undefined;
      const code = codeEl ? await codeEl.getAttribute("label") : undefined;
      // Emptied first (both the WDA and the simctl pasteboard): a Copy that copies nothing must not pass on an earlier
      // run's link left on this simulator (review on #598).
      await a.setClipboard("", "plaintext").catch(() => undefined);
      try { execFileSync("xcrun", ["simctl", "pbcopy", A.udid], { input: "" }); } catch { /* the WDA clear stands */ }
      await tapTestId(a, "MyQRShareLink", 15000);
      // The share sheet's Copy is a cell named "actionGroupCell" whose label is "Copy" (iOS 26), so not "~Copy" by name
      // (the RC rerun 1021-0328 stopped there with the sheet open).
      const copy = await a.$('-ios predicate string:type == "XCUIElementTypeCell" AND label == "Copy"');
      await copy.waitForExist({ timeout: 15000 });
      await copy.click();
      await sleep(1000);
      // The message is the words, then the link on its own line (QRScanner.tsx). Read through WebDriverAgent first, as
      // lib/pages/link.js does: simctl pbpaste came back empty for 10 s on the MacBook while WDA had the link (10-23).
      const clip = Buffer.from((await a.getClipboard("plaintext").catch(() => "")) || "", "base64").toString("utf8").trim();
      link = (clip || simctl("pbpaste", A.udid).trim()).split(/\s+/).pop() || "";
      const isLink = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(link);
      const note = await existsTestId(a, "MyQRShareLinkNote", 3000);
      const error = await existsTestId(a, "MyQRShareLinkError", 1000);
      const log = deviceLog({ platform: "ios", udid: A.udid }, since);
      // The app says which link it made since the short links (#550 era): "made (long)" or "made (short)" (269's run read
      // "[VRC] invitation link: made (long), share sheet opened" and this row, matching the older words, said false).
      const made = /invitation link: made(?: \((?:long|short)\))?, share sheet opened/.test(log);
      // The share sheet logs what it was handed under the app's process; that entry is not the app logging it
      // (lib/appLog.js). Anything else with the link, the app's own lines first, still fails the row.
      const leaked = isLink && appLogged(log, link);
      await screenshot(a, "pair-share-link").catch(() => undefined);
      const differs = code === undefined ? "the code is not readable in a release build" : `a different invitation from the code ${link !== code}`;
      return {
        ok: isLink && made && !leaked && !error && (code === undefined || link !== code),
        detail: `copied a link ${isLink} · ${differs} · "link: made" logged ${made} · the link itself in the app log ${leaked} · MyQRShareLinkNote ${note} · MyQRShareLinkError ${error} (iOS; Android unproven)`,
      };
    });
    await rows.row("pair-share-link-connects", async () => {
      // The code screen is a stacked "Scan QR code" with no tab bar and a header back (testID Back), not the BackButton
      // returnToContacts looks for (1021-0722: ten tries, never left it). Back out of the stack first.
      for (let i = 0; i < 3 && (await existsTestId(a, "Back", 2000)); i++) { await tapTestId(a, "Back", 5000); await sleep(800); }
      await returnToContacts(a);
      simctl("openurl", B.udid, link);
      await acceptRelationshipProposalOnEitherSide(a, b);
      await Promise.all([assertVrcReceived(a, `${B.first} ${B.last}`), assertVrcReceived(b, `${A.first} ${A.last}`)]);
      return { ok: true, detail: `B opened A's shared link with A off the code screen; each lists the other (${A.first} ${A.last} ↔ ${B.first} ${B.last}) (iOS; Android unproven)` };
    });

    // Emoji picker: reactions chosen from the full picker, and an emoji typed in from the composer's button. Each verdict
    // is read on the other phone. Before rows that set a disappearing-message timer: a timer applies only to messages
    // sent after it, so these stay.
    const REACT_TO = "gate: react to this";
    await rows.row("pair-react-picker", async () => {
      await Promise.all([openChatWith(a, B), openChatWith(b, A)]);
      await sendChat(b, REACT_TO);
      if (!(await waitForText(a, REACT_TO))) return { ok: false, detail: `B's "${REACT_TO}" never reached A` };
      // Nothing under it yet, so the reading below is the reaction's doing.
      const before = await reactionsReach(b, "", 2000);
      await openReactionPicker(a, REACT_TO);
      await chooseEmoji(a, "cat", "1F431");
      const closed = !(await existsTestId(a, "EmojiPickerSheet", 3000));
      const onB = await reactionsReach(b, "🐱 1");
      await screenshot(b, "pair-react-picker").catch(() => undefined);
      return { ok: before === "" && closed && onB === "🐱 1", detail: `under B's message before: "${before}" · A's picker closed on choosing ${closed} · B reads "${onB}" (want "🐱 1")` };
    });
    await rows.row("pair-react-same", async () => {
      await openReactionPicker(b, REACT_TO);
      await chooseEmoji(b, "cat", "1F431");
      const want = "🐱 2, including you";
      const [onA, onB] = await Promise.all([reactionsReach(a, want), reactionsReach(b, want)]);
      return { ok: onA === want && onB === want, detail: `A reads "${onA}" · B reads "${onB}" (want "${want}" on both)` };
    });
    await rows.row("pair-react-remove", async () => {
      // Choosing the emoji this phone already reacted with removes it, as tapping it on the bar does (Chat.tsx reactTo).
      await openReactionPicker(a, REACT_TO);
      await chooseEmoji(a, "cat", "1F431");
      const [onA, onB] = await Promise.all([reactionsReach(a, "🐱 1"), reactionsReach(b, "🐱 1, including you")]);
      await screenshot(b, "pair-react-remove").catch(() => undefined);
      return { ok: onA === "🐱 1" && onB === "🐱 1, including you", detail: `A reads "${onA}" (want "🐱 1") · B reads "${onB}" (want "🐱 1, including you")` };
    });
    await rows.row("pair-emoji-composer", async () => {
      await openChatWith(a, B);
      const input = await a.$("-ios class chain:**/XCUIElementTypeTextView");
      await input.waitForExist({ timeout: 15000 });
      await input.setValue("gate: picked ");
      await tapTestId(a, "ChatComposerEmojiButton", 10000);
      if (!(await existsTestId(a, "EmojiPickerSheet", 10000))) return { ok: false, detail: "the composer's emoji button did not open the picker" };
      await chooseEmoji(a, "grinning", "1F600");
      // The composer's sheet stays open for more; it closes only when asked.
      const stayed = await existsTestId(a, "EmojiPickerSheet", 2000);
      await tapTestId(a, "EmojiPickerSheetClose", 5000);
      await (await a.$("~GC_SEND_TOUCHABLE")).click();
      const onB = Boolean(await waitForText(b, "gate: picked 😀"));
      await screenshot(b, "pair-emoji-composer").catch(() => undefined);
      return { ok: stayed && onB, detail: `the sheet stayed open after a choice ${stayed} · B shows "gate: picked 😀" ${onB}` };
    });

    // Message-wake tap: B writes while A is away, then the wake is tapped. The verdict is the screen A lands on: the
    // outcome line (logger.info, TabStack.tsx) reaches the device log only when the build logs at info, so it is detail.
    await rows.row("pair-wake-opens-chat", async () => {
      await a.execute("mobile: pressButton", { name: "home" });
      await returnToContacts(b);
      await (await b.$(`-ios predicate string:label CONTAINS "${A.first} ${A.last}" AND visible == 1`)).click();
      await sendChat(b, "gate: a message for the wake");
      const since = Date.now();
      await pushAndTapWake(a, A.udid, "chat");
      const fetching = await existsTestId(a, "MessagesFetchingNew", 8000);
      let chat = false;
      for (const until = Date.now() + 60000; Date.now() < until && !chat; await sleep(2000)) chat = await onChat(a, B);
      await screenshot(a, "pair-wake-chat").catch(() => undefined);
      return { ok: chat, detail: `tapped a wake with B's message unread: "Fetching new messages…" seen ${fetching} · B's chat open ${chat} · logged ${wakeOutcomes(A.udid, since).join(",") || "no outcome"} (tap path only; the mediator wake isn't exercised)` };
    }, { skip: WAKE_NOT_RUN });
    await rows.row("pair-wake-no-unread-list", async () => {
      const since = Date.now();
      await pushAndTapWake(a, A.udid, "list");
      // The wake looks for an unread message for a while before it settles on the list (messageWake.ts).
      await sleep(20000);
      // AddContact is the Messages list's own header button: present and on screen, not under a chat pushed over it.
      const list = (await existsTestId(a, "AddContact", 5000)) && (await byTestId(a, "AddContact").isDisplayed().catch(() => false));
      const chat = await onChat(a, B);
      await screenshot(a, "pair-wake-list").catch(() => undefined);
      return { ok: list && !chat, detail: `tapped a wake with nothing unread: the Messages list ${list} · a chat open ${chat} · logged ${wakeOutcomes(A.udid, since).join(",") || "no outcome"} (tap path only)` };
    }, { skip: WAKE_NOT_RUN });
  } finally {
    stop();
  }
} catch (e) {
  rows.fatal(e);
  for (const d of [a, b].filter(Boolean)) await screenshot(d, "pair-failure").catch(() => undefined);
} finally {
  rows.summary();
  process.exitCode = rows.exitCode();
  for (const d of [a, b].filter(Boolean)) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
process.exit(process.exitCode ?? 0);
