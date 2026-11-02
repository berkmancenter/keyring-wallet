#!/usr/bin/env node
/**
 * F4-3 ahead of testers: on a wallet already in the room, post a generated file through the composer, open it back from
 * the room's host, and compare sha256. One simulator, so it opens its own post: the bytes through the host and back, not
 * a second member's read. Each run adds a file to the room: a lab write, on Alberto's word.
 *
 * The picker is another process, so Appium's source doesn't show it: tap by point, measured on iOS 26.3 at 402×874
 * (ee, ~/.keyring-gate/handoff/rooms-f4). A first open starts on Recents; a later one lands in "On My iPhone", so set
 * PICKER_IN_FOLDER=1 there. The composer's file chip must name this run's file, so a wrong tap fails instead of posting
 * something else.
 *
 * Rows: rtt-control-open (a file already there, opened the same way), rtt-picked, rtt-posted, rtt-listed, rtt-opened,
 * rtt-sha256, rtt-copy-gone. Nothing is posted unless the control matched and the composer names this run's file.
 *
 *   UDID=… IOS_DEVICE_NAME=… ROOM_NAME="File test room" KNOWN_FILE=… KNOWN_SHA256=… [FILE_BYTES=300000] node run-file-roundtrip.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { postState, roomHandles, troubleOn } from "./lib/pages/rooms.js";
import { createRows } from "./lib/rows.js";

const { UDID, ROOM_NAME, KNOWN_FILE, KNOWN_SHA256 } = process.env;
const FILE_BYTES = Number(process.env.FILE_BYTES ?? 300000);
const PUT = process.env.PUT_FILE ?? `${process.env.HOME}/.keyring-gate/handoff/rooms-f4/put-file-on-sim.sh`;
const BID = process.env.E2E_APP_ID ?? "asml.bkc.harvard.wallet";
const rows = createRows({ label: "file-roundtrip" });
const POINTS = { browse: [287, 821], onMyIphone: [125, 324], firstFile: [71, 258] };

/** A text file no earlier run posted: the chip and the copy can only be this run's. */
function makeFile() {
  const name = `keyring-rtt-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.txt`;
  const path = join(mkdtempSync(join(tmpdir(), "rtt-")), name);
  writeFileSync(path, randomBytes(FILE_BYTES).toString("base64").slice(0, FILE_BYTES));
  return { name, path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

const tapAt = (d, [x, y]) => d.execute("mobile: tap", { x, y });

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const copies = () => {
  const data = execFileSync("xcrun", ["simctl", "get_app_container", UDID, BID, "data"], { encoding: "utf8" }).trim();
  return walk(join(data, "Library/Caches/keyring-room-files"));
};

/** A room with a post sits in Messages as one row; the room's name on the screen says it was the right one. */
async function openRoom(d, name, timeoutMs = 180000) {
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(5000)) {
    await tapTestId(d, "Message", 10000);
    if (await existsTestId(d, "RoomMessageRow", 8000)) {
      await tapTestId(d, "RoomMessageRow", 10000);
      await sleep(3000);
      if (((await d.getPageSource().catch(() => "")) || "").includes(name)) return;
      throw new Error(`the row opened something other than "${name}"`);
    }
  }
  throw new Error(`no room "${name}" in Messages: setup, not a result`);
}

async function chipOf(d, name, timeoutMs = 180000) {
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(3000)) {
    const page = (await d.getPageSource().catch(() => "")) || "";
    for (const h of roomHandles(page, "RoomFileChip_")) {
      if ((await textOf(d, `RoomFileChip_${h}`).catch(() => "")).includes(name)) return h;
    }
  }
  return undefined;
}

/** Tap a file, Download, and wait for its sheet to say which way it went. */
async function openChip(h) {
  await tapTestId(d, `RoomFileChip_${h}`, 15000);
  await tapTestId(d, "RoomFileDownload", 15000);
  const start = Date.now();
  for (const until = start + 300000; Date.now() < until; await sleep(1000)) {
    if (await existsTestId(d, "RoomFileShare", 500)) return { ok: true, detail: `opened in ${Math.round((Date.now() - start) / 1000)} s` };
    if (await existsTestId(d, "RoomFileFailed", 500)) return { ok: false, detail: "RoomFileFailed" };
  }
  return { ok: false, detail: "neither Share nor a failure in 5 min" };
}

let d;
try {
  for (const [k, v] of Object.entries({ UDID, ROOM_NAME, KNOWN_FILE, KNOWN_SHA256 })) if (!v) throw new Error(`driver: ${k} is not set`);
  const file = makeFile();
  console.log(`[e2e] file ${file.name}, ${FILE_BYTES} bytes, sha256 ${file.sha256}`);
  execFileSync("bash", [PUT, UDID, file.path], { stdio: "inherit" });
  await ensureAppium();
  d = await makeDriver({ platform: "ios", udid: UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
  rows.setDriver(d);
  await unlockToHome(d);
  const win = await d.getWindowRect();
  if (win.width !== 402 || win.height !== 874) throw new Error(`driver: the picker's points are for 402×874, this is ${win.width}×${win.height}`);
  await openRoom(d, ROOM_NAME);
  console.log(`[e2e] posting as: ${await textOf(d, "RoomComposerPostingAs").catch(() => "(unread)")}`);

  // The control, before any write: a file already in the room, with a known digest, opens and matches the same way.
  let controlled = false;
  await rows.row("rtt-control-open", async () => {
    const h = await chipOf(d, KNOWN_FILE, 60000);
    if (!h) return { ok: false, detail: `no chip for ${KNOWN_FILE}` };
    const known = await openChip(h);
    if (!known.ok) return known;
    const found = copies();
    const sha = found.length === 1 ? createHash("sha256").update(readFileSync(found[0])).digest("hex") : `${found.length} copies`;
    await tapTestId(d, "RoomFileSheetClose", 15000);
    await sleep(3000);
    controlled = sha === KNOWN_SHA256;
    return { ok: controlled, detail: `${sha} against ${KNOWN_SHA256}` };
  });
  if (!controlled) throw new Error("the control did not match: nothing posted");

  let picked = false;
  await rows.row("rtt-picked", async () => {
    await tapTestId(d, "RoomComposerAttach", 30000);
    await sleep(3500);
    if (!process.env.PICKER_IN_FOLDER) {
      await tapAt(d, POINTS.browse);
      await sleep(1500);
      await tapAt(d, POINTS.onMyIphone);
      await sleep(1500);
    }
    await screenshot(d, "rtt-picker").catch(() => undefined);
    await tapAt(d, POINTS.firstFile);
    if (!(await existsTestId(d, "RoomComposerFile", 30000))) return { ok: false, detail: "no file in the composer after the picker" };
    picked = ((await d.getPageSource().catch(() => "")) || "").includes(file.name);
    return { ok: picked, detail: picked ? `the composer names ${file.name}` : `the composer holds a file, not named ${file.name}` };
  });
  if (!picked) throw new Error("not this run's file: nothing posted");

  await rows.row("rtt-posted", async () => {
    await tapTestId(d, "RoomComposerSend", 15000);
    const start = Date.now();
    let unread = 0;
    for (const until = start + 300000; Date.now() < until; await sleep(2000)) {
      const page = (await d.getPageSource().catch(() => "")) || "";
      const state = postState(page);
      if (state === "failed") return { ok: false, detail: `the room shows ${troubleOn(page).join(", ")}` };
      if (state === "unread") {
        if (++unread >= 5) return { ok: false, detail: "5 reads running found no room on the page" };
        continue;
      }
      unread = 0;
      if (state === "sent" && Date.now() - start > 5000) return { ok: true, detail: `sent in ${Math.round((Date.now() - start) / 1000)} s` };
    }
    return { ok: false, detail: "still sending after 5 min" };
  });

  let chip;
  await rows.row("rtt-listed", async () => {
    await d.$("~Back").then((b) => b.click());
    await sleep(2000);
    await openRoom(d, ROOM_NAME);
    chip = await chipOf(d, file.name);
    return { ok: Boolean(chip), detail: chip ? `chip ${chip}` : `no chip for ${file.name} after leaving and coming back` };
  });
  if (!chip) throw new Error("not listed: nothing to open");

  let opened = false;
  await rows.row("rtt-opened", async () => {
    const r = await openChip(chip);
    opened = r.ok;
    return r;
  });
  if (!opened) throw new Error("not opened: no bytes to compare");

  await rows.row("rtt-sha256", () => {
    const found = copies();
    if (found.length !== 1) return { ok: false, detail: `${found.length} copies under keyring-room-files` };
    const sha = createHash("sha256").update(readFileSync(found[0])).digest("hex");
    return { ok: sha === file.sha256 && found[0].endsWith(`/${file.name}`), detail: `${sha} against ${file.sha256}` };
  });

  await rows.row("rtt-copy-gone", async () => {
    await tapTestId(d, "RoomFileSheetClose", 15000);
    await sleep(5000);
    const left = copies().length;
    return { ok: left === 0, detail: `${left} left 5 s after closing` };
  });
} catch (e) {
  console.log(`❌ run-file-roundtrip: ${String(e?.message || e).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await d?.deleteSession().catch(() => undefined);
  await stopAppium();
}
