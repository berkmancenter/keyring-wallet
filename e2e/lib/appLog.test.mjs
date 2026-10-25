// node --test e2e/lib/appLog.test.mjs
// Fixture lines in the shape `log show --style compact` prints them on iOS 26.3 (MacBook, 10-25), with a made-up link.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appLogged, withoutShareSheet } from "./appLog.js";

const LINK = "https://wallet.example.org/invite?oob=eyJAdHlwZSI6ImZha2UifQ";
const js = (text) => `2026-10-25 06:02:26.519 I  KeyRing[75817:55ba8c] [com.facebook.react.log:javascript] ${text}`;
const shareSheet = [
  "2026-10-25 06:02:26.520 Df KeyRing[75817:55ba4d] [com.apple.ShareSheet:ShareSheet] UIActivityViewController: initialized with activityItems ((",
  `    "${LINK}"`,
  "))",
].join("\n");
const network = "2026-10-25 06:02:26.504 Df KeyRing[75817:55df62] [com.apple.CFNetwork:Default] Task <BD1EB046>.<12> response ended";

test("the share sheet's own entry, link and all, is not the app logging it", () => {
  const log = [network, js("[VRC] invitation link: made (long), share sheet opened"), shareSheet].join("\n");
  assert.equal(appLogged(log, LINK), false);
  assert.ok(withoutShareSheet(log).includes("invitation link: made"));
  assert.ok(withoutShareSheet(log).includes("com.apple.CFNetwork"));
});

test("control: the app's own line with the link still counts, beside the share sheet's", () => {
  const log = [js("[VRC] invitation link: made (long), share sheet opened"), shareSheet, js(`[VRC] sharing ${LINK}`)].join("\n");
  assert.equal(appLogged(log, LINK), true);
});

test("control: a line continuing the app's own entry still counts", () => {
  assert.equal(appLogged([js("[VRC] invitation:"), `    "${LINK}"`, shareSheet].join("\n"), LINK), true);
});

test("control: another Apple framework logging the link still counts; only the share sheet is set aside", () => {
  const other = `2026-10-25 06:02:27.000 Df KeyRing[75817:55ba4d] [com.apple.UIKit:Pasteboard] wrote ${LINK}`;
  assert.equal(appLogged([shareSheet, other].join("\n"), LINK), true);
});

test("no secret, no leak", () => {
  assert.equal(appLogged(js("anything"), ""), false);
});
