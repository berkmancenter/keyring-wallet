#!/usr/bin/env node
// run.mjs: the mediator cases of agent-connect-plan.md step 0.1(a) and 0.1(q),
// against the lab mediator `lab/mediator.sh` started.
//
//   node run.mjs                 run every case for the mode the lab is in
//   node run.mjs --quiet         the same, one line per case
//   node run.mjs --only live,queue
//   node run.mjs --record        write what was observed as this mode's recorded result
//
// Each case reports what it observed as a small object. The run compares that
// with fixtures/recorded-<mode>.json (what this rung measured and froze) and
// exits 1 on any difference. What the plan says for each case is in the
// README, beside what was measured.
//
// The lab is found by asking `lab/mediator.sh status`; MEDIATOR_DID and
// MEDIATOR_MODE name another mediator instead.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mintIdentity, peerIdentity } from "./identity.mjs";
import { sealedForward } from "./envelope.mjs";
import { attach, grantSelfForwarding, mediatorOf, postInbound, tryAttach, tryAuthenticate } from "./mediator.mjs";
import { readProblemReport } from "./refusal.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const record = args.includes("--record");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : undefined;
const say = (...parts) => quiet || console.log(...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function labStatus() {
  if (process.env.MEDIATOR_DID) {
    return { mode: process.env.MEDIATOR_MODE ?? "open", mediatorDid: process.env.MEDIATOR_DID, source: undefined };
  }
  try {
    return JSON.parse(execFileSync(`${here}lab/mediator.sh`, ["status"], { encoding: "utf8" }));
  } catch {
    console.error("no lab mediator is running: start one with `lab/mediator.sh up <open|mailbox|deny>`, or set MEDIATOR_DID");
    process.exit(2);
  }
}

const lab = labStatus();
const MEDIATOR_DID = lab.mediatorDid;
const mediator = await mediatorOf(MEDIATOR_DID);

/** What a send looked like: the status, and the code when it was refused. */
const sent = (answer) => (answer.refused ? { status: answer.status, code: answer.code } : { status: answer.status });
/**
 * `Retry-After` as the mediator sent it: the count of seconds, which is the same on every run, `absent`, or
 * `a date` for an HTTP date, which is a clock reading and so is not recorded.
 */
const retryAfterAsSent = (answer) => {
  const header = answer.raw?.headers?.["retry-after"];
  if (header === undefined) return "absent";
  return /^\d+$/.test(header.trim()) ? Number(header.trim()) : "a date";
};

/**
 * A sender of one of two kinds.
 *
 *   none     never authenticated and holds no session: it POSTs a sealed forward and nothing else. This is the
 *            sender of the plan's section 2.4.
 *   session  an account: it authenticated, switched its own SEND_FORWARDED on, and sends with its session token.
 *            This is what a phone or an agent is on the wallet mailbox.
 */
async function makeSender(kind) {
  const identity = mintIdentity();
  if (kind === "none") return { identity, token: undefined, close() {} };
  const party = await attach(identity, MEDIATOR_DID);
  await grantSelfForwarding(party);
  return { identity, token: party.auth.accessToken, close: () => party.close() };
}

/** Seal a message from `sender` to `recipientDid` and POST it, with the sender's session token when it has one. */
async function send(sender, recipientDid, content, options = {}) {
  const { outer, innerId } = await sealedForward({ sender: sender.identity, recipientDid, mediator, body: { content }, ...options });
  return { answer: await postInbound(mediator, outer, { token: sender.token }), innerId };
}

/** Whether `party` receives the message `innerId` from `senderDid` within `ms`. */
async function receives(party, innerId, senderDid, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    const got = await party.next(left);
    if (!got) return false;
    if (got.message?.id === innerId) return got.sender?.did === senderDid;
  }
}

// A mediator whose default is DENY_ALL refuses every socket, so the cases that open one cannot run on it.
const hasSockets = lab.mode !== "deny";
const cases = [];
const add = (id, title, fn, { socket = true } = {}) => {
  if (socket && !hasSockets) return;
  cases.push({ id, title, fn });
};

for (const kind of ["none", "session"]) {
  const who = kind === "none" ? "a sender with no session" : "a sender that is an account";
  /** Run `body(sender)` with a sender of this kind, and close its socket afterwards. */
  const withSender = (body) => async () => {
    const sender = await makeSender(kind);
    try {
      return await body(sender);
    } finally {
      sender.close();
    }
  };

  add(`live/${kind}`, `${who}; the recipient has an open socket`, withSender(async (sender) => {
    const recipient = await attach(mintIdentity(), MEDIATOR_DID);
    try {
      const { answer, innerId } = await send(sender, recipient.identity.did, "live");
      return { send: sent(answer), delivered: answer.refused ? false : await receives(recipient, innerId, sender.identity.did) };
    } finally {
      recipient.close();
    }
  }));

  add(`offline/${kind}`, `${who}; the recipient has an account and is offline, then connects`, withSender(async (sender) => {
    const identity = mintIdentity();
    (await attach(identity, MEDIATOR_DID)).close();
    await sleep(300);
    const { answer, innerId } = await send(sender, identity.did, "queued");
    if (answer.refused) return { send: sent(answer), delivered: false };
    const recipient = await attach(identity, MEDIATOR_DID);
    try {
      return { send: sent(answer), delivered: await receives(recipient, innerId, sender.identity.did) };
    } finally {
      recipient.close();
    }
  }));

  add(`never-seen/${kind}`, `${who}; the mediator has never heard from the recipient`, withSender(async (sender) => {
    const identity = mintIdentity();
    const { answer, innerId } = await send(sender, identity.did, "before any account");
    if (answer.refused) return { send: sent(answer), delivered: false };
    const recipient = await attach(identity, MEDIATOR_DID);
    try {
      return { send: sent(answer), delivered: await receives(recipient, innerId, sender.identity.did) };
    } finally {
      recipient.close();
    }
  }));

  add(`anonymous/${kind}`, `${who}; the outer forward is anoncrypt`, withSender(async (sender) => {
    const recipient = await attach(mintIdentity(), MEDIATOR_DID);
    try {
      const { answer, innerId } = await send(sender, recipient.identity.did, "anonymous", { anonymous: true });
      return { send: sent(answer), delivered: answer.refused ? false : await receives(recipient, innerId, sender.identity.did, 2500) };
    } finally {
      recipient.close();
    }
  }));

  for (const [id, title, service] of [
    ["peer-here-url", "a did:peer:2 recipient whose service is this mediator's URL", () => mediator.restEndpoint],
    ["peer-here-did", "a did:peer:2 recipient whose service is this mediator's DID", () => MEDIATOR_DID],
    ["peer-elsewhere", "a did:peer:2 recipient whose service names another host", () => "https://mediator.elsewhere.invalid/mediator/v1"],
  ]) {
    add(`${id}/${kind}`, `${who}; ${title}`, withSender(async (sender) => {
      const identity = peerIdentity(mintIdentity(), service());
      const attached = await tryAttach(identity, MEDIATOR_DID);
      if (!attached.ok) return { attached: false };
      try {
        const { answer, innerId } = await send(sender, identity.did, id);
        const wait = id === "peer-elsewhere" ? 8000 : 5000;
        return { attached: true, send: sent(answer), delivered: answer.refused ? false : await receives(attached.party, innerId, sender.identity.did, wait) };
      } finally {
        attached.party.close();
      }
    }));
  }

  add(`queue/${kind}`, `${who}; an offline recipient: how many are queued before a refusal, and what the refusal says`, withSender(async (sender) => {
    const identity = mintIdentity();
    (await attach(identity, MEDIATOR_DID)).close();
    await sleep(300);
    let accepted = 0;
    let refusal;
    for (let i = 0; i < 60 && !refusal; i++) {
      const { answer } = await send(sender, identity.did, `queued ${i + 1}`);
      if (answer.refused) {
        refusal = { ...sent(answer), retryAfter: retryAfterAsSent(answer) };
      } else accepted++;
      // Under the mailbox's limits one DID may make 20 requests a second: stay well below it.
      await sleep(80);
    }
    return { accepted, refusal: refusal ?? "none in 60" };
  }));
}

add("second-socket", "a second socket for the same DID", async () => {
  const identity = mintIdentity();
  const first = await attach(identity, MEDIATOR_DID);
  const second = await tryAttach(identity, MEDIATOR_DID);
  const ended = await Promise.race([first.closed.then(() => true), sleep(3000).then(() => false)]);
  first.close();
  if (second.ok) second.party.close();
  return { secondOpens: second.ok, firstEvicted: ended };
});

add("fresh-key", "a did:key the mediator has never seen: authenticate, then open the socket", async () => {
  const authenticated = await tryAuthenticate(mintIdentity(), MEDIATOR_DID);
  const attached = await tryAttach(mintIdentity(), MEDIATOR_DID);
  if (attached.ok) attached.party.close();
  return { authenticates: authenticated.ok, socketOpens: attached.ok };
}, { socket: false });

for (const kind of ["none", "session"]) {
  const who = kind === "none" ? "a sender with no session" : "a sender that authenticated and did nothing else";
  add(`rest-only/${kind}`, `${who}; the recipient authenticated once and holds no socket`, async () => {
    const recipient = mintIdentity();
    const recipientAuth = await tryAuthenticate(recipient, MEDIATOR_DID);
    const identity = mintIdentity();
    const senderAuth = kind === "session" ? await tryAuthenticate(identity, MEDIATOR_DID) : undefined;
    if (!recipientAuth.ok || (senderAuth && !senderAuth.ok)) return { authenticated: false };
    const { answer } = await send({ identity, token: senderAuth?.auth.accessToken }, recipient.did, "no socket anywhere");
    return { authenticated: true, send: sent(answer) };
  }, { socket: false });
}

add("self-grant", "a new account sends before and after it switches its own SEND_FORWARDED on", async () => {
  const account = await tryAttach(mintIdentity(), MEDIATOR_DID);
  const recipient = await tryAttach(mintIdentity(), MEDIATOR_DID);
  if (!account.ok || !recipient.ok) {
    if (account.ok) account.party.close();
    if (recipient.ok) recipient.party.close();
    return { attached: false };
  }
  try {
    const sender = { identity: account.party.identity, token: account.party.auth.accessToken };
    const to = recipient.party.identity.did;
    const attempt = async (label) => {
      const { answer, innerId } = await send(sender, to, label);
      return { send: sent(answer), delivered: answer.refused ? false : await receives(recipient.party, innerId, sender.identity.did, 3000) };
    };
    const before = await attempt("before the self-grant");
    const { answer, problem } = await grantSelfForwarding(account.party);
    const payload = answer?.body?.payload ?? answer?.body;
    const grant = problem
      ? { refused: readProblemReport(problem)?.code ?? "problem report" }
      : answer
        ? { sendForwarded: JSON.stringify(payload).includes('"sendForwarded":true') }
        : "no answer";
    const after = await attempt("after the self-grant");
    return { attached: true, before, grant, after };
  } finally {
    account.party.close();
    recipient.party.close();
  }
});

// ───────────────────────────────────────────────────────────────── the run

const recordedPath = `${here}fixtures/recorded-${lab.mode}.json`;
const recorded = existsSync(recordedPath) ? JSON.parse(readFileSync(recordedPath, "utf8")).cases : {};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

say(`mediator ${MEDIATOR_DID.slice(0, 44)}…  mode ${lab.mode}`);
if (lab.source) say(`built from ${lab.source.repository} ${lab.source.commit.slice(0, 9)} (v${lab.source.version}), binary sha256 ${lab.binarySha256.slice(0, 16)}…`);

const rows = [];
for (const item of cases) {
  if (only && !only.includes(item.id)) continue;
  let observed;
  try {
    observed = await item.fn();
  } catch (error) {
    observed = { error: String(error?.message ?? error) };
  }
  const known = item.id in recorded;
  const asRecorded = known && same(observed, recorded[item.id]);
  rows.push({ id: item.id, title: item.title, observed, asRecorded: known ? asRecorded : null });
  const mark = !known ? "new " : asRecorded ? "ok  " : "DIFF";
  console.log(`${mark} ${item.id.padEnd(15)} ${JSON.stringify(observed)}`);
  if (known && !asRecorded) console.log(`     recorded        ${JSON.stringify(recorded[item.id])}`);
}

const report = {
  ranAt: new Date().toISOString(),
  mode: lab.mode,
  mediatorDid: MEDIATOR_DID,
  source: lab.source,
  binarySha256: lab.binarySha256,
  config: lab.config,
  node: process.version,
  cases: Object.fromEntries(rows.map((row) => [row.id, row.observed])),
};
mkdirSync(`${here}out`, { recursive: true });
writeFileSync(`${here}out/report-${lab.mode}.json`, `${JSON.stringify(report, null, 2)}\n`);

if (record) {
  mkdirSync(`${here}fixtures`, { recursive: true });
  const frozen = { ...report, cases: Object.fromEntries(rows.map((row) => [row.id, row.observed])) };
  writeFileSync(recordedPath, `${JSON.stringify(frozen, null, 2)}\n`);
  say(`recorded ${rows.length} cases to fixtures/recorded-${lab.mode}.json`);
}

const differing = rows.filter((row) => row.asRecorded === false).length;
const unknown = rows.filter((row) => row.asRecorded === null).length;
say(`${rows.length - differing - unknown} of ${rows.length} as recorded${unknown ? `, ${unknown} with no recorded result` : ""}`);
// Open sockets keep the process alive; every case closed its own, and this ends anything a failure left.
setTimeout(() => process.exit(differing || (unknown && !record) ? 1 : 0), 200);
