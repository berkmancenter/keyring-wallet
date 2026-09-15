# ref-07g-outcome-evidence-pairing

When a credential cites a Trust Task exchange (`taskContext`), a verifier
decides whether that exchange **completed** by pairing the credential with the
exchange's retained documents. Four versions of that pairing rule exist or are
proposed. This rung runs the same seven exchanges through all four and records
which rule says "completed" wrongly, and which says "not completed" wrongly.

```sh
npm install && node run.mjs
```

No network. Every Trust Task document carries a real `eddsa-jcs-2022` proof;
every task digest is computed per Trust Tasks framework 0.5.0.

## The rules

| Rule | Source |
|---|---|
| **witness spec** | `witness/session/submit/0.1`, *This response is the outcome evidence* — `trustoverip/dtgwg-trust-tasks-tf` @ `dd1f8059` |
| **Keyring** | `bifold/packages/core/src/modules/trust-tasks/outcomeEvidence.ts` @ `7dc1de2a`, guarded against drift in Act 0 |
| **#18** | cred-spec PR #18 @ `fc2276b`, *Matching outcome evidence* |
| **generic** | the rule proposed for `dtgwg-trust-tasks-spec` in the #18 split |

All four texts are quoted verbatim in `fixtures/pairing-rules-as-published.md`.

## What it proves

| Exchange | truth | witness spec | Keyring | #18 | generic |
|---|---|---|---|---|---|
| witness ceremony, honest | completed | ✓ | ✓ | **✗ false negative** | ✓ |
| vetting ceremony, honest | completed | ✗ *(out of scope)* | ✓ | ✓ | ✓ |
| initiator minted a `threadId` | completed | ✗ *(out of scope)* | ✓ | ✓ | ✓ |
| cancelled — control `#response` shipped | not | ✗ | **✓ false positive** | ✗ | ✗ |
| `#response` signed by the holder itself | not | ✗ | **✓ false positive** | ✗ | ✗ |
| ended in `trust-task-error` | not | ✗ | ✗ | ✗ | ✗ |
| counterfeit session document reusing the `id` | not | ✗ | ✗ | ✗ | ✗ |

**The witness spec is right for witnessing and does not generalize (Act 2).** Its
`threadId == taskContext` clause is sound only because `witness/session/0.1`
requires the session request's `threadId` to equal its `id`; the framework lets
an initiator mint a fresh one. Its "the evidence's issuer is the credential's
issuer" clause fails for vetting, where the vetter issues the credential and the
applicant signs the response.

**Keyring accepts two things it must not (Act 3).** A `trust-task-control`
`#response` in the session's thread passes, because Keyring only checks that the
type ends in `#response` — the `cancelled` hazard Glenn Gore raised on
trust-tasks-tf#173. A `#response` the holder signed itself passes, because Keyring
verifies the proof under whatever issuer the document names and never asks
whether that is the party the exchange was addressed to. Both are Keyring fixes.

**#18's own text rejects the real witness ceremony (Act 4).** It requires the
terminal to be *the originating request's* Type URI plus `#response`. The witness
exchange is opened by `witness/session` and closed by
`witness/session/submit#response`, so that document never exists.

**The generic rule gets all seven right (Act 5).** It keeps #18's thread pairing
(`initiating.threadId ?? initiating.id`) and changes two things:

1. the terminal's type must be a success response the cited specification
   **declares** as that exchange's outcome evidence;
2. the terminal must be signed by the **initiating document's `recipient`** — the
   party the exchange was addressed to — not by the credential's issuer.

## What it does NOT prove

- **No credential proofs.** The citing credentials are unsigned stand-ins carrying
  only `issuer`, `taskContext` and `taskDigestMultibase`; the question here is the
  pairing, not the credential signature.
- **Not the full witness check.** The witness spec's final clause (the presented
  credential's digest equals `vwcDigestMultibase`) is not modelled.
- **Keyring is modelled, not executed.** `outcomeEvidence.ts` needs a Credo agent;
  its checklist is transcribed, and Act 0 fails if the source stops matching.
- **The declared-evidence map is this rung's.** No specification publishes such a
  declaration today — that is the point of change (1).
- **The minted-thread exchange uses a hypothetical specification**
  (`community.example/spec/attest/0.1`), since both registered ceremonies forbid
  minting.

Pinned against: `dtgwg-trust-tasks-tf` @ `dd1f8059`, `dtgwg-trust-tasks-spec` @
`bf748fb` (framework 0.5.0), cred-spec PR #18 @ `fc2276b`, bifold @ `7dc1de2a`.
