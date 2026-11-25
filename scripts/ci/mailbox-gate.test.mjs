// node --test scripts/ci/mailbox-gate.test.mjs
// The store build's mailbox gate (scripts/ci/mailbox-gate.sh): empty secret → refused with the plain message; set →
// passes; empty but allow_no_mailbox=true → passes, said. It never prints the secret's value.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./mailbox-gate.sh", import.meta.url));
const run = (env) => {
  const r = spawnSync("bash", [script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const DID = "did:webvh:QmTestOnlyScid:mailbox.example:mediator";

test("empty secret, no override: the build is refused with the plain message", () => {
  const r = run({ MAILBOX_MEDIATOR_DID: "", ALLOW_NO_MAILBOX: "false" });
  assert.equal(r.code, 1);
  assert.match(r.out, /MAILBOX_MEDIATOR_DID is not set: the mailbox would ship switched off/);
  assert.match(r.out, /allow_no_mailbox=true/);
});

test("unset secret (the variable absent, as a push-triggered run has it): refused the same way", () => {
  const r = run({});
  assert.equal(r.code, 1);
  assert.match(r.out, /would ship switched off/);
});

test("CONTROL: the secret set: the build goes on, and the value is never printed", () => {
  const r = run({ MAILBOX_MEDIATOR_DID: DID, ALLOW_NO_MAILBOX: "false" });
  assert.equal(r.code, 0);
  assert.match(r.out, /MAILBOX_MEDIATOR_DID is set/);
  assert.doesNotMatch(r.out, /QmTestOnlyScid/);
});

test("CONTROL: empty secret with allow_no_mailbox=true: the build goes on, deliberately, and says so", () => {
  const r = run({ MAILBOX_MEDIATOR_DID: "", ALLOW_NO_MAILBOX: "true" });
  assert.equal(r.code, 0);
  assert.match(r.out, /deliberately/);
});

test("CONTROL: allow_no_mailbox must be exactly true; any other word does not open the gate", () => {
  assert.equal(run({ MAILBOX_MEDIATOR_DID: "", ALLOW_NO_MAILBOX: "yes" }).code, 1);
  assert.equal(run({ MAILBOX_MEDIATOR_DID: "", ALLOW_NO_MAILBOX: "TRUE" }).code, 1);
});
