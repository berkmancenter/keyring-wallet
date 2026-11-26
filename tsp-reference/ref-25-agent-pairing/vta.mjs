// vta.mjs: a client of one VTA over its HTTPS binding, as an identity the VTA's access list names.
//
// At VTI f7b78e29d every call is a Trust Task document POSTed to `/trust-tasks` with the task's URI in a
// `Trust-Task` header (vta-sdk `auth_light.rs`). Signing in is two of them: `auth/challenge/0.1`, unsigned, and
// `auth/authenticate/0.3`, signed by the holder's own key. Every later task carries the session's access token
// and is signed the same way (eddsa-jcs-2022, purpose `authentication`).

import { randomUUID } from "node:crypto";
import { signTask } from "./mediator.mjs";

const SPEC = "https://trusttasks.org/spec/";
export const task = (path) => `${SPEC}${path}`;
export const ERROR_TYPE_PREFIX = `${SPEC}trust-task-error/`;

const wireTime = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST, waiting out a 429. A VTA limits sign-in attempts per address and says when to come back; its own client
 * waits and sends again (vta-sdk `redeem_challenge`), and so does this one, for at most two minutes in all.
 */
async function post(baseUrl, type, document, token) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const answer = await postOnce(baseUrl, type, document, token);
    if (answer.status !== 429 || Date.now() >= deadline) return answer;
    const seconds = Number(answer.retryAfter);
    await sleep(Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000, 30_000));
  }
}

async function postOnce(baseUrl, type, document, token) {
  const headers = { "content-type": "application/json", "Trust-Task": type };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/trust-tasks`, { method: "POST", headers, body: JSON.stringify(document) });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Kept as text.
  }
  return { status: response.status, retryAfter: response.headers.get("retry-after") ?? undefined, body };
}

/**
 * What a VTA answered, reduced: `ok` with the payload, or a refusal with its code.
 * A Trust Task error is a document whose type is `trust-task-error/<version>` and whose payload has `code`.
 */
export function readAnswer({ status, retryAfter, body }) {
  const document = body && typeof body === "object" ? body : {};
  const payload = document.payload ?? {};
  const isError = typeof document.type === "string" && document.type.startsWith(ERROR_TYPE_PREFIX);
  if (status >= 200 && status < 300 && !isError) return { ok: true, status, type: document.type, payload };
  return {
    ok: false,
    status,
    code: typeof payload.code === "string" ? payload.code : typeof document.code === "string" ? document.code : undefined,
    message: typeof payload.message === "string" ? payload.message : typeof body === "string" ? body.slice(0, 300) : undefined,
    retryAfter,
    payload,
  };
}

/** Sign in as `identity`. Throws with the VTA's refusal when either step is refused. */
export async function signIn({ baseUrl, vtaDid, identity }) {
  const challengeType = task("auth/challenge/0.1");
  const challengeDocument = {
    id: `urn:uuid:${randomUUID()}`,
    type: challengeType,
    issuer: identity.did,
    recipient: vtaDid,
    issuedAt: wireTime(),
    payload: { subject: identity.did },
  };
  const challenge = readAnswer(await post(baseUrl, challengeType, challengeDocument));
  if (!challenge.ok) throw Object.assign(new Error(`auth/challenge refused: ${challenge.status} ${challenge.code ?? ""}`), { answer: challenge });

  const authenticateType = task("auth/authenticate/0.3");
  const signed = signTask(identity, authenticateType, vtaDid, {
    challenge: challenge.payload.challenge,
    sessionId: challenge.payload.sessionId,
    scope: [],
  });
  const session = readAnswer(await post(baseUrl, authenticateType, signed));
  if (!session.ok) throw Object.assign(new Error(`auth/authenticate refused: ${session.status} ${session.code ?? ""}`), { answer: session });
  return { baseUrl, vtaDid, identity, token: session.payload.tokens.accessToken, session: session.payload.session };
}

/** `signIn` that reports a refusal as a result. */
export async function trySignIn(args) {
  try {
    return { ok: true, session: await signIn(args) };
  } catch (error) {
    return { ok: false, status: error.answer?.status, code: error.answer?.code, error: String(error.message) };
  }
}

/** Send one task on a session and reduce the answer. `path` is the task without the prefix, such as `auth/whoami/0.1`. */
export async function call(session, path, payload = {}) {
  const type = task(path);
  const document = signTask(session.identity, type, session.vtaDid, payload);
  return readAnswer(await post(session.baseUrl, type, document, session.token));
}
