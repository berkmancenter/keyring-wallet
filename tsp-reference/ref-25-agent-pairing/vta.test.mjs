// Reading a VTA's answers. The refusal's payload is what the lab VTA (vta 0.79.0) returned for an unserved version.
// The error document's version (0.6) is only an example here: `readAnswer` matches the type's prefix, not its version.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_TYPE_PREFIX, readAnswer, task } from "./vta.mjs";

const unsupported = {
  status: 422,
  body: {
    type: `${ERROR_TYPE_PREFIX}0.6`,
    payload: {
      code: "unsupportedVersion",
      details: {
        requestedType: "https://trusttasks.org/spec/vta/contexts/list/0.1",
        servedVersions: ["https://trusttasks.org/spec/vta/contexts/list/1.0"],
      },
      message: "unsupported version: https://trusttasks.org/spec/vta/contexts/list/0.1",
      retryable: false,
    },
  },
};

test("a task URI is the spec prefix and the path", () => {
  assert.equal(task("auth/whoami/0.1"), "https://trusttasks.org/spec/auth/whoami/0.1");
});

test("a response document is ok and gives its payload", () => {
  const answer = readAnswer({ status: 200, body: { type: "https://trusttasks.org/spec/auth/whoami/0.1#response", payload: { roles: ["admin"], scopes: [] } } });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.payload, { roles: ["admin"], scopes: [] });
});

test("a refusal gives its status, its code and what the VTA serves instead", () => {
  const answer = readAnswer(unsupported);
  assert.equal(answer.ok, false);
  assert.equal(answer.status, 422);
  assert.equal(answer.code, "unsupportedVersion");
  assert.deepEqual(answer.payload.details.servedVersions, ["https://trusttasks.org/spec/vta/contexts/list/1.0"]);
});

test("an error document is a refusal even under a 200", () => {
  const answer = readAnswer({ status: 200, body: { type: `${ERROR_TYPE_PREFIX}0.6`, payload: { code: "permissionDenied", message: "no" } } });
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "permissionDenied");
});

test("a body that is not a document is a refusal with no invented code", () => {
  const answer = readAnswer({ status: 502, body: "Bad Gateway" });
  assert.equal(answer.ok, false);
  assert.equal(answer.code, undefined);
  assert.equal(answer.message, "Bad Gateway");
  assert.equal(readAnswer({ status: 429, retryAfter: "3", body: {} }).retryAfter, "3");
});
