// node --test e2e/lib/walletCards.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { walletCardKeys, walletCardSelector } from "./walletCards.js";

const node = (id, attrs) =>
  `<node index="0" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")} resource-id="com.ariesbifold:id/${id}" class="android.widget.TextView" />`;

test("an older build: one key per issuer|card-name pair from the issuer", () => {
  const src = [
    node("CredentialIssuer", { text: "Keyring Lab Community" }),
    node("CredentialName", { text: "Member of Keyring Lab Community" }),
    node("CredentialIssuer", { text: "Keyring Lab Community" }),
    node("CredentialName", { text: "Vetter for Keyring Lab Community" }),
    node("CredentialIssuer", { text: "Someone Else" }),
    node("CredentialName", { text: "Member of Someone Else" }),
  ].join("");
  assert.equal(walletCardKeys(src, "Keyring Lab Community").length, 2);
});

test("a pass build: one key per pass whose description names the issuer, the same community's cards apart", () => {
  const src = [
    node("CommunityPass", { "content-desc": "Keyring Lab Community, Member, Member since 26 Sep 2026", text: "" }),
    node("CommunityPassTitle", { text: "Keyring Lab Community" }),
    node("CommunityPass", { "content-desc": "Keyring Lab Community, Vetter, Valid until 26 Oct 2026", text: "" }),
    node("CommunityPassTitle", { text: "Keyring Lab Community" }),
    node("CommunityPass", { "content-desc": "Someone Else, Member, Member since 1 Oct 2026", text: "" }),
  ].join("");
  assert.equal(walletCardKeys(src, "Keyring Lab Community").length, 2);
  // The same page read twice (scrolled back) is still two cards.
  assert.equal(walletCardKeys(src + src, "Keyring Lab Community").length, 2);
});

test("escaped characters in a name still match", () => {
  const src = node("CommunityPass", { "content-desc": "O&apos;Brien &amp; Co, Member, Member since 1 Oct 2026", text: "" });
  assert.equal(walletCardKeys(src, "O'Brien & Co").length, 1);
});

test("the selector matches either build's card name id, by the community's name", () => {
  const s = walletCardSelector('Keyring "Lab"');
  // One backslash before the dot: UiAutomator reads the id as a regular expression.
  assert.ok(s.includes('resourceIdMatches("com\\.ariesbifold:id/(CommunityPassTitle|CredentialName)")'), s);
  assert.ok(s.includes('textContains("Keyring \\"Lab\\"")'), s);
});
