# Pairing rules under test, quoted verbatim

## A. `witness/session/submit/0.1` — trustoverip/dtgwg-trust-tasks-tf @ dd1f8059, "This response is the outcome evidence", item 2

> A verifier pairing them checks: the session document's `id` equals the VWC's
> `taskContext` **and the VWC's `taskDigestMultibase` reproduces over that
> document** under §4.9.3, comparing decoded multihash bytes rather than
> encoded strings; the evidence's `threadId` equals the
> VWC's `taskContext`; the evidence's `type` is this specification's
> `#response`; the evidence's own REQUIRED proof verifies; the evidence's
> `issuer` is the witness that issued the VWC; and the presented credential's
> digest equals the evidence's `vwcDigestMultibase`.

and `witness/session/0.1`, Conformance item 1: the session request is emitted "with a fresh `id`, `threadId` equal to that `id`".

## B. Keyring — bifold/packages/core/src/modules/trust-tasks/outcomeEvidence.ts @ 7dc1de2a, "The pairing checklist" (guarded by run.mjs Act 0)

```ts
if (taskContext && String(initiating.id ?? '') !== taskContext) { … }
if (taskDigest && !digestBytesEqual(taskDigest, taskDigestMultibase(initiating))) { … }
const expectedThread = String(initiating.threadId ?? initiating.id ?? '')
if (String(terminal.threadId ?? '') !== expectedThread) { … }
if (terminalType.includes(ERROR_TYPE_MARKER)) { … } else if (!terminalType.endsWith('#response')) { … }
… verifyDocumentProof(agent, terminal, String(terminal.issuer ?? '')) …
```

## C. cred-spec PR #18 @ fc2276b, Outcome Interpretability, "Matching outcome evidence"

> - the terminal document carries a `threadId` equal to the initiating document's `threadId` where the initiator minted one, and to the initiating document's `id` … `terminal.threadId == (initiating.threadId ?? initiating.id)`
> - the terminal document carries a `type` that is the originating request's Type URI with the `#response` fragment — the qualifying specification's terminal *success* form; and
> - the terminal document carries a `proof` that verifies under that specification's declared requirement, and whose `issuer` is the party the qualifying specification names as the responder of that exchange

## D. Proposed generic rule (this rung) — for the Trust Tasks framework draft

1. initiating `id` equals the citation; the task digest reproduces over the initiating document (decoded bytes);
2. terminal `threadId` equals `initiating.threadId ?? initiating.id`;
3. terminal `type` is a success response the cited specification **declares** as that exchange's outcome evidence;
4. terminal `proof` verifies, and its signer is the initiating document's `recipient` — the party the exchange was addressed to;
5. an error response, or the response to a control document, is never completion evidence.
