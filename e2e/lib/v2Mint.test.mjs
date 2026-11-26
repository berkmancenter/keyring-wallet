// node --test e2e/lib/v2Mint.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { expectV2Invitation, mintedInvitation, RunSkipped, SKIPPED_EXIT_CODE, V2_MINT_KILL_REASON } from "./v2Mint.js";

test("a skipped run exits 77, the skip code: neither the pass's 0 nor the failure's 1", () => {
  assert.equal(SKIPPED_EXIT_CODE, 77);
});

const V2 = "https://wallet.asml.berkmancenter.org/invite?_oob=eyJ0eXBlIjoiaHR0cHM6Ly9kaWRjb21tLm9yZy9vdXQtb2YtYmFuZC8yLjAvaW52aXRhdGlvbiJ9";
const V1 = "https://wallet.asml.berkmancenter.org/invite?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24ifQ";

test("an out-of-band/2.0 invitation is the one a v2 run needs, handed back as is", () => {
  assert.equal(mintedInvitation(V2), "v2");
  assert.equal(expectV2Invitation(V2), V2);
});

test("a 1.x invitation on a v2 run is the kill: SKIPPED with the reason, not a failure", () => {
  assert.equal(mintedInvitation(V1), "v1");
  assert.throws(() => expectV2Invitation(V1), (e) => e instanceof RunSkipped && e.message === V2_MINT_KILL_REASON);
  assert.match(V2_MINT_KILL_REASON, /DIDCOMM_V2_MINT_REMOTE_OFF/);
  assert.match(V2_MINT_KILL_REASON, /#1018/);
});

test("CONTROL: anything else is the failure it always was, never a skip", () => {
  assert.equal(mintedInvitation("https://wallet.asml.berkmancenter.org/invite"), "other");
  assert.throws(() => expectV2Invitation("https://wallet.asml.berkmancenter.org/invite"), (e) => !(e instanceof RunSkipped));
  // `_oob` must not be read as `oob`: a short link's `_oobid=` is neither
  assert.equal(mintedInvitation("https://wallet.asml.berkmancenter.org/i/2b7c0f1e2b7c0f1e?_oobid=x"), "other");
});
