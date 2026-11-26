# ref-21-hcp-over-trust-tasks: the proposed `hcp/*` Trust Tasks, run the way Keyring would run them

A reference program for reviewing the proposal to carry the Human Context Protocol (HCP 2.0-draft-3) as Trust
Tasks: trustoverip/dtgwg-trust-tasks-tf #1380 (the 28 `hcp/*` specs), #1382 (its demos), and the design for the
VTA as the HCP provider in OpenVTC/verifiable-trust-infrastructure #2823. It takes the proposal as it is and runs
one person's session end to end, through a real mediator, with mock data and throwaway keys.

The review it belongs to is in [`docs/spikes/20261125-hcp-trust-tasks-review/`](../../docs/spikes/20261125-hcp-trust-tasks-review/).

## What runs

Three parties, each a fresh `did:key` with its own socket on the mediator. Every document travels as a sealed
Direct TSP message in the proposal's `binding/tsp/0.1` envelope.

| Party | Plays | Signs and checks with |
|---|---|---|
| VTA (toy HCP provider) | the VTA with the `hcp` feature, as #2823 designs it | the proposal's TypeScript libraries: `TspConsumer` (SPEC 7.2 proof, freshness, replay, schema, size) and `signTrustTask` |
| Agent | the Context Client (our planned plugin's role) | the proposal's TypeScript libraries |
| Keyring | the Management Client and the bound approver | **Keyring's own code**: `packages/trust-tasks/src/documentProof.ts` (sign, verify, digests, timestamps) and `proofPurpose.ts`, loaded from this repository. `consentCheck.ts` and `VtaClient.sendTask`'s reply reading are mirrored line for line from `main` at `c65701c91`, because they reach `react-native` and cannot load under Node |

The session:

1. The agent asks for a grant (`hcp/grants/request`). The VTA holds it with a `trust-task-next-step` and sends
   Keyring a signed `task-consent/request` carrying HCP's 6.1.6 checklist as effects.
2. Keyring checks the request, shows the checklist and the match code, the person approves, and Keyring signs
   `task-consent/decision`. The agent resubmits on the same thread and gets the grant and its token.
3. The agent reads context (`hcp/entries/query`).
4. Keyring adds a memory (`hcp/entries/create`), lists grants, reads the audit and the disclosure summary.
5. Keyring revokes. The agent receives `hcp/grants/revoked` twice with one `noticeId`, acknowledges both and
   acts once. Its next query is refused.
6. Probes: an unsigned request, a token used from another DID, Keyring's two proof purposes, a declined request,
   the consent request typed with `#request`, a governance task with no token, and what vta-mcp's `vta_call`
   would do (read from source).

Every payload on the wire is checked against the proposed schema. Where HCP has a schema for the same object
(grant, entry, create request, query result, audit event, disclosure summary) it is checked against HCP's own
schema too.

## Run

```sh
./setup.sh        # fetches the proposal (e163cac1d) and HCP's spec (b790561) into .upstream/, builds the TS libraries
npm install
npm start                        # through the ecosystem dev mediator (MEDIATOR_DID=did:... for another)
npm start -- --loopback          # no network: in-memory delivery
npm run check                    # quiet, in-memory
npm run probe:tsp-version        # the TSP version probe below
```

Node 22.6 or later (the TypeScript runs directly). Keyring's code is read from this repository, so the repository
root needs its `yarn install` (for `@credo-ts/core`); `KEYRING_ROOT=/path/to/another/checkout` overrides.
`HCP_TT_ROOT` and `HCP_SPEC_ROOT` point at other checkouts of the proposal and of HCP's spec. A run writes
`out/report.json`; the run recorded below is frozen in
[`fixtures/report-2026-11-25-dev-mediator.json`](./fixtures/report-2026-11-25-dev-mediator.json).

## What it proves (2026-11-25, through the ecosystem dev mediator)

31 of 37 checks as expected; 48 frames, the largest 3,171 bytes. The in-memory run gives the same result.

- The hold and the resubmission on the same thread work.
- **Keyring's own code fits.** Its consent check accepts the VTA's `task-consent/request`, and it shows the match
  code and the checklist. The VTA's pipeline accepts Keyring's decision (signed `assertionMethod`) and Keyring's
  `hcp/*` requests (signed `authentication`, which is what `proofPurpose.ts` picks; `assertionMethod` is
  accepted too). Keyring's reply check accepts the VTA's replies.
- An unsigned request that carries a token is refused `proofRequired`; a token used from another DID is refused
  `permissionDenied`.
- Create, list, audit, summary and revoke work; the notice is acknowledged and deduplicated; the old token is
  refused `hcp:invalidToken`, and Keyring's reply reading turns that into a refusal with the code intact.
- The grant, the entry, the create request, the query result (after its one documented rename, HCP `timestamp`
  to `respondedAt`), the audit events and the disclosure summary are all valid against **HCP's own schemas**.

The six checks that differ are the findings:

| Check | What happened | Whose |
|---|---|---|
| `v0-no-token` | A memory added with no `accessToken`, as #2823 has Keyring do in V0, is refused `malformedRequest`: every governance schema makes `accessToken` required | the specs and the VTI design disagree |
| `probe-declined` | When the person declines, the agent gets the same neutral `permissionDenied` as any refusal | the specs |
| `mcp-vta-call-thread` | (read from source, not run) vta-mcp's `vta_call` takes `{operation, payload}`, and vta-sdk gives every document a fresh id and no `threadId` (`vta-sdk/src/client/mod.rs:4203-4213` at `f7b78e29d`), so a held grant request cannot be resubmitted on its thread | vta-mcp and our plugin plan |
| `mcp-vta-call-next-step` | (read from source, not run) vta-sdk returns any payload without `code` and `message` as a result (`client/mod.rs:2492-2510`), so a held reply reaches the agent as the answer | vta-mcp and our plugin plan |
| `probe-consent-fragment` | Keyring's consent check refuses a `task-consent/request` typed `…/request/0.1#request` as `malformed`. The framework says a consumer accepts both forms | Keyring; fixed on the branch `fix/consent-request-type-forms` |
| `probe-next-step-as-result` | Keyring's `sendTask` returns a held reply's payload as the task's result | Keyring; fixed on the branch `fix/vta-held-reply-and-retry-fields` |

`npm run probe:tsp-version` shows one more thing: the proposal's TypeScript TSP library writes TSP 0.1
(`YTSP-AAB`) and does not recognise a frame marked 1.0 (`YTSP-BAA`), which is what Keyring packs to a VTA and
what the VTA at our pin reads.

## What it does not prove

- **Not the real VTA.** The provider is a toy that follows the specs and #2823's design. The real `vta-hcp` does
  not exist yet; the authorization, the consent producer and the effects here are ours.
- **Not Keyring's real transport.** Keyring reaches its VTA over DIDComm v2 authcrypt, and over TSP 1.0 where
  the VTA supports it. Every party here uses the proposal's TSP library, so every frame is TSP 0.1.
- **Not Keyring's real key store, screens or biometric.** Keyring's signing code runs with the key handed to it
  in memory, and the person's approval is mocked.
- **The two vta-mcp rows were read from source, not run.**
- One run, one mediator, no load, no network faults.

## A note on the dev mediator

The ecosystem dev mediator was re-created on 2026-09-27 under
`did:webvh:QmR5xGk8pkd3ymu7xpfkjr7XZmwDALA5ZJmgG7qcrD2mKA:webvh.storm.ws:mediator`. The older DID, still the
default in [`ref-04-mediator`](../ref-04-mediator/) and [`ref-06x-cypress-stack`](../ref-06x-cypress-stack/),
no longer resolves ("SCID in DID does not match SCID in log"). Pointing `ref-04` at the new DID is not enough:
it authenticates and sends, but its routed frame is not delivered within 20 seconds. Direct frames are delivered,
as this rung shows. Neither older rung is changed here.

Pinned against: the proposal at `e163cac1d` (trust-tasks-tf #1382, which contains #1380 at `94ed4200c`),
`hcp-spec` `b790561`, `@openvtc/vti-didcomm-js` 0.6.2, and through the proposal's TSP library
`@openvtc/vti-tsp-js` 0.2.0.
