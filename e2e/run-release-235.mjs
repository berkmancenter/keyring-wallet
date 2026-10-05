#!/usr/bin/env node
/**
 * Release 235's new device rows, on an Android build whose phone is already linked (run-vta-link.js,
 * LINK_MODE=manual, E2E_KEEP_APP=1) to the runner agent RUNNER_VTA. Rows, in this order whatever ROWS lists:
 *
 *   in124       My devices loads, or says "Your agent didn't answer. Try again." within 15 s (bifold #308, IN-124)
 *   devices     Add another device by a fresh did:key: the name field defaults to "Computer"; after Add the
 *               agent's ACL label is that name; Rename beside Remove changes the label (bifold #307, #308).
 *               The did:key is removed from the ACL afterwards.
 *   identity    "Show the code they see" on the community card for C_DID shows this identity's DID (bifold #305).
 *               Needs a phone that is a member of C.
 *   scanbeside  On the linked phone, paste another agent's bare DID (OTHER_AGENT_DID) on the scanner: it is offered
 *               as another agent, not refused as "already linked" (bifold #303). Leaves without linking it.
 *
 *   E2E_APP_ID=… UDID=emulator-5572 RUNNER_VTA=<slug> PNM_BIN=… DEVICE_PIN=1234 C_DID=… OTHER_AGENT_DID=…
 *   ROWS="in124 devices identity scanbeside" node run-release-235.mjs
 *
 * DEVICE_PIN: the emulator's screen-lock PIN, set by the caller after the first link. Adding or renaming a device
 * is an owner act, confirmed in the system's BiometricPrompt; the PIN is typed only into that window.
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { dumpSource, ensureAppium, existsTestId, screenshot as rawScreenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { pasteLinkFromHome } from "./lib/flows.js";
import { communityCardKey } from "./lib/testIdKeys.js";

const E = process.env;
const UDID = E.UDID;
const SLUG = E.RUNNER_VTA;
const PNM = E.PNM_BIN;
const PIN = E.DEVICE_PIN || "";
const ROWS = (E.ROWS || "in124 devices identity scanbeside").split(/\s+/);
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);
const results = [];
const row = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`ROW ${name} ${ok ? "PASS" : "FAIL"} — ${detail}`);
};
const adb = (...a) => execFileSync("adb", ["-s", UDID, ...a], { encoding: "utf8", timeout: 30000 });
const shot = (d, name) => rawScreenshot(d, name).catch(() => undefined);
const said = async (d, id) => ((await existsTestId(d, id, 1500)) ? (await textOf(d, id).catch(() => "")).replace(/\s+/g, " ").trim() : null);

/** The system's owner check (BiometricPrompt / device credential): type the PIN there and nowhere else. */
async function owner(tag) {
  let win = "";
  for (let i = 0; i < 16 && !win; i++) {
    await sleep(500);
    win = (adb("shell", "dumpsys", "window", "windows").match(/Window\{[^}]*(AuthContainer|BiometricPrompt|ConfirmDeviceCredential)[^}]*\}/i) || [""])[0];
  }
  if (!win || !PIN) return false;
  log(`owner check (${tag}): typing the PIN`);
  adb("shell", "input", "text", PIN);
  adb("shell", "input", "keyevent", "66");
  await sleep(2500);
  return true;
}

/** The ACL entry for `subject`, read with the runner agent's admin key. */
function aclEntry(subject) {
  const out = execFileSync(PNM, ["--vta", SLUG, "acl", "list", "--json"], { encoding: "utf8", env: { ...E }, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out.slice(out.indexOf("["))).find((e) => e.subject === subject);
}

/** A fresh did:key (Ed25519): another device's code, never used to sign anything. */
function freshDidKey() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const bytes = Buffer.concat([Buffer.from([0xed, 0x01]), raw]);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return `did:key:z${out}`;
}

async function myAgent(d) {
  await tapTestId(d, "MyAgent", 15000);
  await sleep(1500);
}

async function openDevices(d) {
  await myAgent(d);
  await scrollToTestId(d, "AgentDevices", 6).catch(() => undefined);
  await tapTestId(d, "AgentDevices", 15000);
}

/** The text of every device row, keyed by its testID suffix. */
async function deviceRows(d) {
  const rows = [];
  for (const el of await d.$$(`//*[starts-with(@resource-id,"com.ariesbifold:id/AgentDevice_")]`)) {
    const id = String(await el.getAttribute("resource-id")).replace("com.ariesbifold:id/AgentDevice_", "");
    let text = "";
    for (const c of await d.$$(`//*[@resource-id="com.ariesbifold:id/AgentDevice_${id}"]//*[@text!=""]`)) text += `${await c.getAttribute("text")} `;
    rows.push({ key: id, text: text.trim() });
  }
  return rows;
}

let d;
const extraKeys = [];
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
  await d.activateApp(E.E2E_APP_ID);
  // The PIN screen can submit itself on the last digit and be gone before the helper finds its Enter
  // (21:56Z: "Enter not found", the app already on Contacts). Home is what counts.
  await unlockToHome(d).catch(async (e) => {
    if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
    log(`unlock helper: ${e.message.split("\n")[0].slice(0, 80)} — but the app is unlocked (My Agent tab present)`);
  });

  if (ROWS.includes("in124")) {
    await openDevices(d);
    const t = Date.now();
    let outcome = "";
    while (!outcome && Date.now() - t < 15000) {
      if (await existsTestId(d, "AgentDeviceList", 500)) outcome = "list";
      else if (await existsTestId(d, "AgentDeviceError", 500)) outcome = "error";
    }
    await shot(d, "release235-in124-devices");
    const error = outcome === "error" ? await said(d, "AgentDeviceError") : null;
    log(`My devices after ${((Date.now() - t) / 1000).toFixed(1)} s: ${outcome || "neither"}${error ? ` ("${error}")` : ""}`);
    row(
      "in124 My devices loads or says it didn't answer (15 s)",
      outcome === "list" || (outcome === "error" && /Your agent didn't answer\. Try again\./.test(error ?? "")),
      outcome ? `${outcome}${error ? `: "${error}"` : ""}` : "neither the list nor the no-answer line within 15 s"
    );
  }

  if (ROWS.includes("devices")) {
    const code = freshDidKey();
    extraKeys.push(code);
    log(`another device's code: ${code.slice(0, 28)}…`);
    await openDevices(d);
    await waitForTestId(d, "AgentDeviceList", 30000);
    await tapTestId(d, "AgentDeviceAdd", 15000);
    for (const id of ["AgentBackupEnterCode", "AgentBackupNext"]) {
      if (await existsTestId(d, id, 4000)) {
        await tapTestId(d, id, 10000);
        break;
      }
    }
    const input = await waitForTestId(d, "AgentBackupCodeInput", 20000);
    await input.setValue(code);
    const nameField = await waitForTestId(d, "DeviceNameInput", 15000);
    const defaultName = String((await nameField.getAttribute("text")) || "").trim();
    log(`the name field reads "${defaultName}"`);
    await shot(d, "release235-device-name-default");
    row('devices name defaults to "Computer"', defaultName === "Computer", `the field reads "${defaultName}"`);
    await scrollToTestId(d, "AgentBackupAdd", 4).catch(() => undefined);
    await tapTestId(d, "AgentBackupAdd", 15000);
    await owner("add another device");
    let added;
    for (let i = 0; i < 20 && !added; i++) {
      await sleep(1500);
      added = aclEntry(code);
    }
    row('devices ACL label is the name', added?.label === defaultName, added ? `label "${added.label}"` : "the code never reached the ACL");

    // Rename it beside Remove: the newest row named like it.
    await waitForTestId(d, "AgentDeviceList", 30000);
    const mine = (await deviceRows(d)).filter((r) => r.text.includes(defaultName)).pop();
    const newName = `Gate desk ${Date.now() % 10000}`;
    if (!mine) {
      row("devices rename changes the label", false, `no device row named "${defaultName}" on My devices`);
    } else {
      await tapTestId(d, `AgentDeviceRename_${mine.key}`, 15000);
      const rename = await waitForTestId(d, "DeviceNameInput", 15000);
      await rename.clearValue();
      await rename.setValue(newName);
      await tapTestId(d, "DeviceNameSave", 15000);
      await owner("rename a device");
      let renamed;
      for (let i = 0; i < 20 && renamed?.label !== newName; i++) {
        await sleep(1500);
        renamed = aclEntry(code);
      }
      await shot(d, "release235-device-renamed");
      row("devices rename changes the label", renamed?.label === newName, `label "${renamed?.label ?? "-"}" (wanted "${newName}")`);
    }
    // The device wording (#307): the add screen and the list say "device", not "computer".
    const words = (await d.getPageSource()).match(/text="[^"]*(device|Device)[^"]*"/g) ?? [];
    log(`"device" wording on My devices: ${JSON.stringify(words.slice(0, 4))}`);
  }

  if (ROWS.includes("identity")) {
    const key = communityCardKey(E.C_DID || "");
    await myAgent(d);
    await scrollToTestId(d, `AgentCommunityIdentity_${key}Toggle`, 8).catch(() => undefined);
    const has = await existsTestId(d, `AgentCommunityIdentity_${key}Toggle`, 5000);
    const label = has ? await said(d, `AgentCommunityIdentity_${key}Toggle`) : null;
    let did = null;
    if (has) {
      await tapTestId(d, `AgentCommunityIdentity_${key}Toggle`, 10000);
      await sleep(1000);
      did = await said(d, `AgentCommunityIdentity_${key}Did`);
    }
    await shot(d, "release235-identity-code");
    row(
      'identity "Show the code they see" shows the identity',
      Boolean(has && /Show the code they see/.test(label ?? "") && /^did:/.test(did ?? "")),
      has ? `toggle "${label}", code "${(did ?? "").slice(0, 40)}…"` : "no identity toggle on the community card"
    );
  }

  if (ROWS.includes("scanbeside")) {
    if (!E.OTHER_AGENT_DID) throw new Error("scanbeside needs OTHER_AGENT_DID");
    await pasteLinkFromHome(d, E.OTHER_AGENT_DID);
    await sleep(3000);
    const page = await d.getPageSource();
    const refused = /already linked to an agent/.test(page);
    const offered = ["VtaLinkWithoutQr", "VtaLinkAgentAddress", "VtaLinkManualDid", "VtaLinkCheckGrant", "VtaLinkConfirm"];
    let at = "";
    for (const id of offered) if (!at && (await existsTestId(d, id, 1500))) at = id;
    await shot(d, "release235-scan-beside");
    await dumpSource(d, "release235-scan-beside").catch(() => undefined);
    row("scanbeside another agent is offered beside, not refused", !refused && Boolean(at), refused ? 'the phone said "already linked"' : at ? `the link flow opened (${at})` : "neither the link flow nor a refusal");
    await d.back().catch(() => undefined);
    await sleep(1500);
  }
} catch (e) {
  console.log(`[e2e] error: ${e.message.split("\n")[0]}`);
  if (d) {
    await shot(d, "release235-failure");
    await dumpSource(d, "release235-failure").catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  for (const k of extraKeys) {
    try {
      execFileSync(PNM, ["--vta", SLUG, "acl", "delete", k], { encoding: "utf8", env: { ...E }, stdio: ["ignore", "pipe", "pipe"] });
      log(`removed the test device ${k.slice(0, 28)}…`);
    } catch (e) {
      log(`could not remove ${k}: ${e.message.split("\n")[0]}`);
    }
  }
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
  for (const r of results) console.log(`SUMMARY ${r.name} ${r.ok ? "PASS" : "FAIL"} — ${r.detail}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
