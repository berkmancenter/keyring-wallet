---
name: vti-lab-and-field
description: How Keyring proves VTI/vetting work — the local lab we own versus the VTA Farm we don't, which claims each one can support, and how a finding earns its way into docs/VTI_UPSTREAM_FINDINGS.md. Use when running or writing VTI e2e, standing up the local stack, moving work onto the farm, or recording anything as an upstream finding.
---

# The lab and the field

Two environments, different jobs. Getting them confused is how a finding gets
reported that turns out to be a fixture artefact, or how a demo fails on real
infrastructure after weeks of green runs locally.

## The lab: `scripts/openvtc/local-vti-stack/`

Three VTAs, a VTC, a mediator and a DID-hosting daemon, each behind its own
HTTPS hostname. **We own the community.** That is the whole point of it, and
the only reason to keep paying for the complexity.

Because we own the VTC we can publish criteria (`minStatements`,
`maxStatementAge`, `minByMethod`, independence caps), issue and **revoke** a
vetter's grant mid-ceremony, drive a capacity limit, and set the ACL. Nothing
else we have can do any of that.

```sh
./scripts/openvtc/local-vti-stack/up.sh        # everything; writes stack.env
./scripts/openvtc/local-vti-stack/up.sh --stop
```

`stack.env` carries the DIDs and URLs. Two of them get baked into `app/.env`
(`VTI_MEDIATOR_DID`, `VTI_COMMUNITY_DID`) and **react-native-config reads
`.env` at native build time**, so changing it means rebuilding the app, not
restarting Metro. Community setup — statement type, criterion — goes through
`tsp-reference/ref-20-local-vetting/vtc-admin.mjs`.

## The field: the VTA Farm

Their managed infrastructure. Geoff keeps a staging instance on latest mains,
which makes it the practical answer to "which version is the contract".

**The farm provisions VTAs, not communities.** Bootstrapping a VTC is the
sysop path — its own host, mediator and DID host — and `vti-setup`'s
community-manager guide for it is still unwritten. So on the farm we are
members: applicant and vetter. We cannot set criteria, revoke a grant, or force
a capacity refusal.

Provisioning also needs a human at a browser once per VTA: the client generates
a temporary admin `did:key`, and someone pastes it into the farm UI and clicks
**Provision agent**. Our own `up.sh` labels the equivalent step *"the paste a QR
would replace"* — the friction is the same in both places, which is worth
saying when we ask them for a QR or an API rather than framing it as a Keyring
problem.

## Which environment supports which claim

| Claim | Where it can be made |
| --- | --- |
| A rule is implemented correctly | unit tests — no stack at all |
| The happy path works end to end | lab, then confirmed on the field |
| A refusal path behaves | **lab only** — it needs a community we control |
| A protocol detail matches the real server | field; the lab agrees only if its version does |
| Something upstream is broken | lab is enough to *find* it; the field is what makes it credible |

Reach for a stack only when a claim needs one. Most vetting rules are pure
functions over facts (`packages/trust-tasks/src/vetting/`) and are tested
without an agent, a network or a community — that is deliberate, and new rules
should keep it that way.

## The promotion path

Build → unit green → **lab** green → **field** validation → record.

Skipping the lab means debugging on infrastructure you cannot instrument.
Skipping the field means shipping something that only ever met a fixture.

Do not move to the field mid-feature. Finish what needs the lab's control
first, then re-run the same ceremonies against the farm as a validation pass.

## Fixture deviations are declared, not silently carried

Every knob we turn on the lab to make something work is a difference between
our fixture and a real deployment, and a finding measured across one is worth
less unless it is stated. Two are on record already — a raised mediator
sender-queue limit, and a stuck queue cleared by hand — and both are named in
the findings doc's *Stack under test* section.

Rule: **if you change the fixture to get a green run, say so in the same
commit.** A finding that quietly depends on an unusual configuration is the
kind that gets reported, investigated upstream, and bounced.

Redis is a particular trap. Clearing a queue with `DEL` leaves the account
record's `SEND_QUEUE_COUNT` stale, so the sender stays rate-limited against a
queue that is already empty. Upstream's `#825`/`#826` are the supported way;
if you do it by hand, reset the counters too.

## Recording a finding

`docs/VTI_UPSTREAM_FINDINGS.md` is living and versioned. Conventions that
matter:

- **`VTI-NN` numbers are permanent.** A finding that turns out to be wrong is
  corrected in place, never renumbered and never deleted.
- **`VTI-QN` is for questions**, not defects — things we guessed at and would
  rather be told. Each one we guess at is a guess baked into the client.
- **Every finding names the era it was measured on**, because the fixture gets
  rebuilt and "the stack" is not one thing over time.
- **Classify before recording**: is this ours to fix, or theirs? Record theirs;
  never silently work around it. Something can be both — a fix of theirs can
  put an obligation on us, and that gets said on the finding rather than
  discovered later.

**Before writing a finding, try to disprove it.** Read the upstream source in
`external/` — pinned, and confirm you are reading *that* clone and not another
checkout on the machine. A finding that upstream cannot reproduce costs more
credibility than it buys, and the usual cause is a title that claims something
narrower or wider than the body. Title the claim you can defend.

When upstream fixes one, say so on the finding and link the PR. When upstream
says it does not reproduce, **check before arguing** — more than once the title
was the defect.

## Watch upstream, deliberately

Upstream is actively working our findings — they track them as **`KR-NN`**
against our `VTI-NN` — and PRs land that change what our client has to do.
This is not background reading; a merged PR can silently invalidate a finding,
close one, or create work for us.

The repos that matter, and what each one moves:

| Repo | What lands there |
| --- | --- |
| `affinidi/affinidi-tdk-rs` | the mediator — queues, limits, CORS, live delivery |
| `OpenVTC/verifiable-trust-infrastructure` | VTA, VTC, `vta-mobile-core` |
| `affinidi/affinidi-webvh-service` | DID hosting |
| `OpenVTC/openvtc` | PNM/TUI, and the design docs that define the ceremony |
| `OpenVTC/vti-setup` | the setup guides, including the farm flow |
| `OpenVTC/vta-mobile-agent-ios` | their own phone client — closest prior art to ours |

```sh
gh pr list --repo affinidi/affinidi-tdk-rs --state all --limit 20 \
  --json number,title,state,updatedAt \
  --jq '.[] | "\(.number) [\(.state)] \(.title)"'
gh pr view <n> --repo <repo> --json title,state,body
```

Check at the start of a work session and whenever one is mentioned. Read the
**whole** PR body — upstream writes unusually detailed ones, and the useful
part is often a stated limitation rather than the change itself.

Three things to do with every relevant PR:

1. **Does it close one of ours?** Say so on the finding, link the PR, and move
   it in the summary table. A findings doc that still calls something open
   after it was fixed reads as not paying attention.
2. **Does it put an obligation on us?** This is the one that gets missed.
   `#830` fixes a dropped live notification by sending an unsolicited pickup
   `status` and reasons that recovery "needs no new protocol on the client
   side" — true of the protocol, false of our client, which dropped every
   pickup frame that was not an answer to its own request. Their fix, our work.
   Ask it of every merged PR.
3. **Does it change what we measured?** Re-check findings on the new version
   before quoting old numbers at them. A fix can also *reveal* something —
   `VTI-31` was found by running the ceremony against `#829` before it landed.

Validating a PR before it merges is worth doing when it touches a path we
depend on, and it is welcome: build the branch, run the ceremony, report what
happened. Say plainly whether the change is good, because a report that only
lists problems reads as opposition to a fix we actually want.

Comments go up under the user's account, in the generic register the findings
doc uses — never signed or attributed to an agent, and never quoting anything
private.

## Traps that have actually cost time

- Emulators and simulators cannot do hardware attestation; the app falls back
  silently. Only device runs prove those paths.
- Never edit app or bifold sources while an e2e is running — Metro fast-refresh
  corrupts the run.
- The findings doc and the plan documents are read by people outside this
  repo. No names, no private conversations, no quoting anything that was not
  published.
