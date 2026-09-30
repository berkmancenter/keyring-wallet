# Open issues for the OpenVTC maintainers

**One list, current as of 23 September 2026.** Everything still open from Keyring's
side, in one place, so it can be read straight through or handed to an assistant to
work from. No history, no changelog, no pull-request archaeology — for the full record
of how each was measured, including the commands, the observed output and the upstream
source each behaviour lives in, see [`VTI_UPSTREAM_FINDINGS.md`](VTI_UPSTREAM_FINDINGS.md).

Numbers are permanent and never reused. Anything not listed here is either resolved or
answered.

**Severity** is ours, from a phone client's point of view:

- **Blocker** — no workaround exists; something a person wants to do cannot be done.
- **Costly** — there is a workaround, but the failure is silent or names the wrong
  cause, so it costs a day before anyone knows what they are looking at.
- **Minor** — worked around, or it only costs a little care.

---

## Blockers and silent failures

### VTI-41 — TSP Rev 3 does not complete across two mediators

**Severity: Blocker.** A client on one mediator forms a TSP relationship with a
community on another and never receives the accept. The invite is stored — the
community's mediator says so — and nothing comes back, in 30 to 90 seconds, whether the
frame is routed via our mediator or posted straight to theirs. The same community on the
*same* mediator accepts in 1.15 s and answers a manifest over TSP in 0.33 s.

DIDComm between those same two mediators works on every route, which is how we know the
path itself is fine.

**What we'd like:** the return leg looked at with the mediators' logs or relay
configuration, which we cannot see. We ruled out the relay allowlist under defaults (an
empty list admits any peer).

**Our workaround:** Keyring asks a community behind another mediator over DIDComm from
the first message. That took a join from about 34 seconds to about 10.5.

---

### VTI-42 — Services refuse verbs they themselves dispatch

**Severity: Blocker in effect, and misleading.** A community tells a deferred applicant
to close its request with `vtc/join-requests/withdraw/0.1`, then answers that exact task
`unsupported message type`. The same document inside the binding envelope
(`https://trusttasks.org/binding/didcomm/0.1/envelope`) is served normally and withdraws
the request in under a second.

`vta-service` has the same gap: a task-typed `auth/whoami/0.1` is refused as unsupported;
enveloped it works and returns a proper `permissionDenied`.

Measured on two communities, both VTC 0.11.58, so it is not specific to one deployment.
`withdraw/0.2` is refused identically, so it is not a version-string mismatch.

**Why it costs a day:** the refusal arrives as a DIDComm problem-report rather than a
`trust-task-error`, so a client correlating by task type reads it as silence. It first
reached us as "the community did not answer".

**What we'd like:** confirmation that the binding envelope is the intended remedy in both
services, and whether the task-typed arms will be kept in step meanwhile. A client cannot
tell which verbs are reachable by which shape.

---

### VTI-43 — A reply dispatched before the relationship that would carry it

**Severity: Blocker, intermittent.** A VTA answers a first Trust Task correctly in under
a second and dispatches the answer **328 ms before** it accepts the inbound TSP
relationship. The client never receives it. Eleven seconds later in the same log the same
three events occur in the opposite order, 4 ms apart, and the answer arrives.

It costs any flow whose first task is deliberately sent before authorisation — which is
exactly Keyring's no-QR linking path, where "I've been added" then never resolves.
Granting access first passes on the same build and the same device.

**What we'd like:** is a VTA expected to dispatch a refusal before the relationship is
Bidirectional, and if not, where is the reply dropped? Our evidence establishes the
**ordering**, not the drop; localising it needs a packet capture or a VTA-side send-path
trace, which we have not taken.

---

## Worth fixing, not blocking

### VTI-37 — A consent refusal loses its challenge once the approver set grows

**Severity: Costly.** A task held for consent is refused with `auth:consent_required`,
and its `details` carry what the requester needs to act: the digest it correlates the
grant by, and one VTA-signed consent request per approver — the documents a requester
relays when the VTA has no route to an approver.

`details` are bounded at 4,096 bytes of canonical JSON and the whole member past it is
dropped, keeping the code. With two approvers the challenge fitted; **with three it did
not**, and the requester received a bare `auth:consent_required` with nothing to act on.

**What we'd like:** either a bound that degrades by dropping the least useful member, or
a refusal that says what it dropped.

---

### VTI-38 — A cancelled relationship is forgotten before the cancel can be answered

**Severity: Minor.** TSP Rev 3 §7.3 says a cancellation of a relationship held in both
directions is answered with a cancellation, *before* it is forgotten. Both halves of the
stack mean to do this, in the wrong order: the inbound control path advances the
relationship to `None` and only then reports that a reply is expected, so the answer is
computed from the state now stored and refused.

---

### VTI-39 — A TSP reply that fails to send once is lost

**Severity: Minor, observed once.** A VTA carried out a key export over TSP, dispatched
the reply, and logged a transport failure 19 ms later. There is no retry and no record:
the asker waits on an answer that no longer exists.

**What we'd like:** one retry, or a record the asker can poll.

---

### VTI-40 — The browser client can record an Approve as a Deny

**Severity: Costly, and the fix is one line.** In the VTA Wallet extension's consent
window, the decision is sent and the window is closed without waiting for the send to be
delivered. The close then settles as a denial, so an Approve can be recorded as a Deny —
silently, with the person believing they approved.

**What we'd like:** await the delivery before closing. We have a patch if it is wanted.

---

## Reproductions we owe you

Three items were read differently by each side. These are ours to produce, and we mention
them so they are not waiting on us unknowingly.

| # | What we still owe |
| --- | --- |
| VTI-06 | Our case is TOML scoping, not the CORS half — a reproduction showing a misplaced key accepted in silence. |
| VTI-12 | Whether a community's advertised transports can now be changed after mint, tested on current pins. |
| VTI-25 | A trace of one admission showing the card delivered rather than returned. |

---

## Questions — not defects

Things we would like answered or changed, rather than bugs.

| # | The question | Why it matters to a phone |
| --- | --- | --- |
| Q2 | Will the reference client keep accepting a DIDComm-carried `vetting/request/0.1`, or must a peer speak TSP Rev 3? | Our applicant ↔ vetter leg is DIDComm today. |
| Q3 | `vetters/list/0.1` cannot distinguish a revoked vetter from an unlisted one. A status field, or a by-DID lookup? | Our applicant otherwise falls back to each grant's status list — a fetch and a signature check per vetter. |
| Q4 | Is borrowing a persona's signing key the expected pattern for signing a Vetting Card, or should the VTA sign it? | It settles our custody model. |
| Q6 | Does a dry-run gate assume the vetter's statement is stored in the VTA vault rather than on the device? | We hold it on the device. |
| Q11 | Should a persona minted by a TSP-capable VTA advertise `TSPTransport` itself? | Personas advertise DIDComm only, so a Rev 3 client keeps applicant ↔ vetter on DIDComm. |
| Q12 | An invitation not bound to a subject DID in advance — a bearer or by-reference form. | An invitation must name the person before they exist to the community, and runs about 6.3 KB. There is no scannable way to invite a newcomer. |
| Q13 · Q14 | Which admin sign-in a Farm operator should use, and what `registryConsent` grants. | Both were guessed at during setup; one sentence settles each permanently. |
| Q16 | How can a client tell whether hidden-vetting anonymity holds? | It depends on operator separation between a vetter's VTA, the mediator and the community — which a client cannot observe, and therefore cannot honestly promise a person. |
| Q17 | An idempotency key on `vta/webvh/dids/create/1.0`, or a `dids/list` carrying the label and the minted key ids. | The mint succeeds and its answer is lost; the client cannot recover, because the list returns neither the label it sent nor the key ids it needs. The person retries and an orphan DID is left behind. **Seen three times, most recently by a person on a released build at their first join** — so it is on the ordinary first-run path. |
| Q18 | Could the Full Stack wizard echo the admin DID it imports? | It takes a key and shows nothing back, so an operator cannot tell a successful import from a silently rejected one until much later. |
| Q19 | Is a VTA meant to be human-nameable, and if so where should a client read the name? | An agent exposes nothing authoritative to show a person: ACL entries carry a grant's label, contexts carry their own names, neither is the agent's name. An app can only show a DID, or a name the person typed. |
| Q20 | Could a member ask a community what it holds for them? | A credential a community pushes can be lost in transit. The member then has no way to ask for it and no way to discover that this is what happened — they simply appear to have no role. |

---

## One of ours, stated rather than hidden

A vetter whose role is revoked and granted again sometimes never received the new one. We
reported that as a defect. On current code the whole cycle works — a role removed shows on
the phone in seconds, a new one arrives in about a minute — and the original failure has
not been reproduced. The likeliest explanation is a selection bug in our own client, fixed
on 22 September: the credential arrived and the client kept choosing the dead one.

We are settling it before saying anything firmer, and we mention it because it was raised
with you as a question and should not be left hanging.
