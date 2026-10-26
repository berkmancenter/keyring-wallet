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
 * Photos (rich messaging Step 3; bifold #584, #588, S3-3b, S3-4b). A's library is seeded with a 2400 x 1800 JPEG that
 * carries a GPS position (fixtures/test-chat-photo-gps.jpg):
 *   pair-photo-send           A sends it from the composer's "+" > Photo library: both phones show it in a bubble
 *   pair-photo-no-location    the file each phone keeps, read from its app container: no Exif segment, no GPS, no XMP
 *                             packet (which can carry a location too), at most 1600 px on its long edge and 256 KiB.
 *                             The fixture itself reads as carrying GPS (the positive control), so a clean result is
 *                             the re-encode's doing, not a blind scanner's
 *
 * Disappearing messages (rich messaging Step 4, H7; bifold #570, #572, H5's sheet). Needs a test build with E2E_CLOCKS=short,
 * where an hour's timer runs in DISAPPEAR_SECONDS (60, the Developer screen's E2EDisappearHourSeconds):
 *   pair-timer-set            A sets 1 hour from the chat menu's Disappearing messages sheet: A shows "You set messages
 *                             to disappear after"
 *   pair-timer-line           B shows the system line "<A> set messages to disappear after"
 *   pair-timer-message        A sends a message under the timer; B reads it with the chat open (its clock starts there)
 *   pair-timer-gone           within the interval plus a sweep, it has gone from both phones, and the two untimed
 *                             messages the emoji rows left (sent before the timer) are still on both: the control
 *   pair-timer-background     B goes to the home screen with the chat open; A sends; B comes back without scrolling, and
 *                             the message still goes from both phones in time (its clock started on return, or from the
 *                             seen stamp as the backstop)
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
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptSystemAlertIfPresent, byTestId, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { acceptRelationshipProposalOnEitherSide, assertVrcReceived, completeOnboarding, dismissTourIfPresent, openQrSheet, returnToContacts, unlockIfLocked } from "./lib/flows.js";
import { appLogged } from "./lib/appLog.js";
import { exifConcerns } from "./lib/exifTags.mjs";
import { jpegMetadata } from "./lib/jpegMetadata.mjs";
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
    "pair-photo-send": ["pair-share-link-connects"],
    "pair-photo-no-location": ["pair-photo-send"],
    "pair-timer-set": ["pair-share-link-connects"],
    "pair-timer-line": ["pair-timer-set"],
    "pair-timer-message": ["pair-timer-line"],
    "pair-timer-gone": ["pair-timer-message"],
    "pair-timer-background": ["pair-timer-gone"],
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

/**
 * The photo bubbles in the open chat, by their label ("📷 Photo, <time>", ChatMessage.tsx). Not by the ChatMessageImage
 * id: once a transcript is long the driver's snapshot stops short of it (0 on B and 8 on A with 11 photos on screen, 10-25).
 */
async function countPhotos(d) {
  return (await d.$$('-ios predicate string:label BEGINSWITH "📷 Photo,"')).length;
}

/** Whether the open chat shows at least `count` photo bubbles within `timeout`. */
async function waitForPhotos(d, count, timeout) {
  for (const until = Date.now() + timeout; Date.now() < until; await sleep(2000)) if ((await countPhotos(d)) >= count) return true;
  return false;
}

/** The newest file in any chat's media folder in the app's data container on simulator `udid` (media/store.ts). */
function newestChatPhoto(udid) {
  const data = simctl("get_app_container", udid, APP, "data").trim();
  const root = path.join(data, "Library", "Application Support", "chat-media");
  let newest;
  for (const chat of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const name of readdirSync(path.join(root, chat.name))) {
      const file = path.join(root, chat.name, name);
      const at = statSync(file).mtimeMs;
      if (!newest || at > newest.at) newest = { file, at };
    }
  }
  return newest?.file;
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

/**
 * Back out of stacked screens (a chat, its Contact Details) toward the tabs: up to four presses of whichever back the
 * screen has, its testID Back or BackButton, or a header button labelled "Back". returnToContacts knows BackButton only,
 * and a chat opened through Contact Details sits two screens deep behind headers without it.
 */
async function backOut(d) {
  for (let i = 0; i < 4; i++) {
    if (await existsTestId(d, "Contacts", 1000)) return;
    if (await existsTestId(d, "Back", 1000)) await tapTestId(d, "Back", 3000).catch(() => undefined);
    else if (await existsTestId(d, "BackButton", 1000)) await tapTestId(d, "BackButton", 3000).catch(() => undefined);
    else {
      const back = await d.$('-ios predicate string:type == "XCUIElementTypeButton" AND label == "Back" AND visible == 1');
      if (!(await back.isExisting())) return;
      await back.click();
    }
    await sleep(1000);
  }
}

async function openChatWith(d, peer) {
  await backOut(d);
  await returnToContacts(d);
  await (await d.$(`-ios predicate string:label CONTAINS "${peer.first} ${peer.last}" AND visible == 1`)).click();
  // A contact opens on its details page; its "View Messages" (ContactDetails.tsx) opens the chat.
  if (await existsTestId(d, "ContactViewMessages", 5000)) await tapTestId(d, "ContactViewMessages", 5000);
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

/** An hour's timer in this build, in seconds: 60 in a short-clock test build (E2EDisappearHourSeconds). */
const DISAPPEAR_SECONDS = Number(process.env.DISAPPEAR_SECONDS || 60);
/** How long a timed message may take to go: its clock, one expiry sweep (every 60 s), and margin for delivery. */
const DISAPPEAR_BUDGET_MS = (DISAPPEAR_SECONDS + 60 + 45) * 1000;

/** Whether a message with `text` is on the open chat now (not waited for). */
async function shows(d, text) {
  return d.$(`-ios predicate string:label CONTAINS "${text}" AND visible == 1`).isExisting();
}

/**
 * Whether a message with `text` is in the open chat at all, on screen or scrolled off it (not waited for). Disappearing
 * checks use this, not shows(): with a photo bubble in the transcript an older message can sit off screen, which
 * shows() would read as gone (a false pass) or as missing from the control (a false fail). gifted-chat virtualises old
 * rows, but this transcript (about eight items) is well inside its first render window.
 */
async function inChat(d, text) {
  return d.$(`-ios predicate string:label CONTAINS "${text}"`).isExisting();
}

/** Poll both phones until `text` has gone from both, or the budget is spent; returns when each lost it (ms), or null. */
async function goneFromBoth(a, b, text, budgetMs = DISAPPEAR_BUDGET_MS) {
  const start = Date.now();
  const gone = { a: null, b: null };
  for (const until = start + budgetMs; Date.now() < until && (gone.a === null || gone.b === null); await sleep(5000)) {
    if (gone.a === null && !(await inChat(a, text))) gone.a = Date.now() - start;
    if (gone.b === null && !(await inChat(b, text))) gone.b = Date.now() - start;
  }
  return gone;
}

/** From the open chat, set its disappearing-messages timer through the chat menu's sheet (H5). */
async function setTimerFromMenu(d, seconds) {
  await tapTestId(d, "ContactMenu", 10000);
  await tapTestId(d, "ContactMenuDisappearing", 10000);
  if (!(await existsTestId(d, "ChatDisappearingSheet", 10000))) throw new Error("driver: the Disappearing messages sheet did not open");
  await tapTestId(d, `ChatDisappearingOption-${seconds}`, 10000);
  await tapTestId(d, "ChatDisappearingSave", 10000);
  await sleep(1500);
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
      // A tap while the sheet is still sliding in can miss: the sheet stays up and nothing is copied (10-25 run 3 and
      // 4 on the MacBook, screenshot shows the sheet still open). Copy dismisses the sheet, so tap until it goes.
      for (let i = 0; i < 3 && (await copy.isExisting()); i++) {
        await sleep(800);
        await copy.click().catch(() => undefined);
        await sleep(1200);
      }
      if (await copy.isExisting()) return { ok: false, detail: "the share sheet stayed open after three taps on Copy: nothing was copied" };
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

    // Photos (Step 3): before the timer rows, so the photo is untimed and still on both phones when its file is read.
    const PHOTO_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "test-chat-photo-gps.jpg");
    await rows.row("pair-photo-send", async () => {
      // No `simctl privacy grant photos`: on iOS 26 it kills the running app and still does not give full access, so
      // the app asks anyway (10-25). The app's own prompt is answered below instead.
      simctl("addmedia", A.udid, PHOTO_FIXTURE);
      await openChatWith(a, B);
      const before = { a: await countPhotos(a), b: await countPhotos(b) };
      // iOS 26 asks for the photo library with three buttons (Limit Access…, Allow Full Access, Don't Allow). The
      // session auto-accepts alerts the moment they appear, and its default button left access denied (10-25), so the
      // button it accepts is named before the tap that raises the prompt, and reset after.
      await a.updateSettings({ acceptAlertButtonSelector: '**/XCUIElementTypeButton[`label == "Allow Full Access"`]' }).catch(() => undefined);
      try {
        await tapTestId(a, "ChatActionsButton", 10000);
        await tapTestId(a, "ChatAttachLibrary", 10000);
        await sleep(2000);
        const full = await a.$('-ios predicate string:type == "XCUIElementTypeButton" AND label == "Allow Full Access"');
        if (await full.isExisting()) await full.click();
      } finally {
        await a.updateSettings({ acceptAlertButtonSelector: "" }).catch(() => undefined);
      }
      await sleep(2000);
      // A denied permission shows only a passing toast (Chat.PhotoNoPermission), which once read as "no picker".
      if (await a.$('-ios predicate string:label CONTAINS "needs permission to use the camera or your photos"').isExisting()) {
        return { ok: false, detail: "the app reports no permission for the photo library (Chat.PhotoNoPermission)" };
      }
      // The system picker runs out of process: its grid is not in the app's tree and cannot be queried, so the newest
      // photo is tapped where it is drawn. The picker lists newest first by capture date; the fixture has none, so
      // the photo just added is first, top left (checked on screen, iPhone 17, 10-25).
      await a.execute("mobile: tap", { x: 66, y: 216 });
      for (const label of ["Add", "Choose", "Done"]) {
        const button = await a.$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}" AND visible == 1`);
        if (await button.isExisting()) await button.click();
      }
      const onA = await waitForPhotos(a, before.a + 1, 60000);
      const onB = await waitForPhotos(b, before.b + 1, 90000);
      await screenshot(b, "pair-photo-send").catch(() => undefined);
      return { ok: onA && onB, detail: `A shows the photo it sent ${onA} · B shows the photo ${onB} (photo bubbles before: A ${before.a}, B ${before.b})` };
    });
    await rows.row("pair-photo-no-location", async () => {
      const fixture = jpegMetadata(readFileSync(PHOTO_FIXTURE));
      if (!fixture.gps) return { ok: false, detail: "the fixture reads as carrying no GPS: the scan proves nothing" };
      const verdicts = [];
      let ok = true;
      for (const [who, d] of [["A", A], ["B", B]]) {
        const file = newestChatPhoto(d.udid);
        if (!file) {
          ok = false;
          verdicts.push(`${who}: no photo file in chat-media`);
          continue;
        }
        const bytes = readFileSync(file);
        const m = jpegMetadata(bytes);
        // The re-encode keeps a small Exif block of layout tags, so the check is that nothing in it is about a person,
        // a device, a place or a time, and that no thumbnail (IFD1) rides along: lib/exifTags.mjs's allowlist.
        const concerns = exifConcerns(bytes);
        const clean = m.jpeg && !m.gps && !m.xmp && concerns.length === 0 && Math.max(m.width ?? 0, m.height ?? 0) <= 1600 && bytes.length <= 256 * 1024;
        ok &&= clean;
        verdicts.push(`${who}: GPS ${m.gps} · XMP ${m.xmp} · Exif beyond layout tags: ${concerns.join(", ") || "none"} · ${m.width}x${m.height} · ${bytes.length} bytes`);
      }
      return { ok, detail: `the fixture carries GPS ${fixture.gps} · ${verdicts.join(" · ")}` };
    });

    // Disappearing messages (H7). The two messages the emoji rows sent came before the timer, so they stay untimed: they
    // are the control that only the timed messages go.
    const TIMED = `gate: disappears ${Date.now().toString(36)}`;
    const AWAY = `gate: sent while away ${Date.now().toString(36)}`;
    await rows.row("pair-timer-set", async () => {
      await openChatWith(a, B);
      await setTimerFromMenu(a, 3600);
      const line = Boolean(await waitForText(a, "You set messages to disappear after", 15000));
      await screenshot(a, "pair-timer-set").catch(() => undefined);
      return { ok: line, detail: `A shows "You set messages to disappear after…" ${line}` };
    });
    await rows.row("pair-timer-line", async () => {
      await openChatWith(b, A);
      const line = await waitForText(b, "set messages to disappear after", 60000);
      const said = line ? ((await line.getAttribute("label")) ?? "") : "";
      await screenshot(b, "pair-timer-line").catch(() => undefined);
      return { ok: said.includes(A.first) && !said.startsWith("You"), detail: `B's system line: "${said.slice(0, 100)}"` };
    });
    await rows.row("pair-timer-message", async () => {
      await sendChat(a, TIMED);
      const onB = Boolean(await waitForText(b, TIMED, 60000)); // B has the chat open: it is shown as it arrives
      return { ok: onB && (await shows(a, TIMED)), detail: `B shows "${TIMED}" ${onB}` };
    });
    await rows.row("pair-timer-gone", async () => {
      const gone = await goneFromBoth(a, b, TIMED);
      const kept = (await inChat(a, "gate: react to this")) && (await inChat(b, "gate: react to this")) && (await inChat(a, "gate: picked")) && (await inChat(b, "gate: picked"));
      await screenshot(b, "pair-timer-gone").catch(() => undefined);
      return {
        ok: gone.a !== null && gone.b !== null && kept,
        detail: `gone from A after ${gone.a ?? "—"} ms, from B after ${gone.b ?? "—"} ms (budget ${DISAPPEAR_BUDGET_MS} ms for ${DISAPPEAR_SECONDS} s) · the untimed messages still on both ${kept}`,
      };
    });
    await rows.row("pair-timer-background", async () => {
      // B leaves the open chat for the home screen; A sends; B comes back to the same chat and does not scroll.
      await b.execute("mobile: pressButton", { name: "home" });
      await sleep(1500);
      await sendChat(a, AWAY);
      await sleep(10000);
      await b.execute("mobile: activateApp", { bundleId: APP });
      await unlockIfLocked(b).catch(() => undefined);
      const arrived = Boolean(await waitForText(b, AWAY, 60000));
      const gone = arrived ? await goneFromBoth(a, b, AWAY) : { a: null, b: null };
      await screenshot(b, "pair-timer-background").catch(() => undefined);
      return {
        ok: arrived && gone.a !== null && gone.b !== null,
        detail: `B shows it on return ${arrived} · gone from A after ${gone.a ?? "—"} ms, from B after ${gone.b ?? "—"} ms`,
      };
    });

    // Message-wake tap: B writes while A is away, then the wake is tapped. The verdict is the screen A lands on: the
    // outcome line (logger.info, TabStack.tsx) reaches the device log only when the build logs at info, so it is detail.
    await rows.row("pair-wake-opens-chat", async () => {
      await a.execute("mobile: pressButton", { name: "home" });
      await openChatWith(b, A);
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
