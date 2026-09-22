# Upstream review of the vetting report — what it changes

2026-09-19. The upstream maintainers reviewed the 18 September report-out
against their own code. This records what they confirmed, what they found
missing, and what we do about it. Their review reached us privately, so
nothing here is quoted in anything published; the substance is ours to act
on and the findings below are written in our own words.

## Confirmed against upstream's implementation

- **The ceremony shape is right, step for step**: ticket → request → session
  → spoken code → card → statement → meets requirements → `allow` → member is
  the flow as implemented.
- **The match code**: eight characters, Crockford base32 (no I/L/O/U, so
  nothing is confusable when read aloud), rendered `XXXX-XXXX`. It is
  **domain-separated** — vetting derives under its own label and personhood
  under another, and the same UUID must never produce the same code in both.
  Our implementation matches; the domain separation is worth an explicit test.
- **Tickets are client-local in V0** — the reference client keeps them in its
  own book and nothing goes to the VTA. Ours does the same.
- **VTI-21** (no channel delivers an invitation) — corroborated in their
  source: the admin invite route's own comment says the operator delivers the
  URL, and the community service only ever *verifies* an invitation
  credential. There is no issuance or delivery path. This is also why their
  client's invitation step has a paste row at all.
- **VTI-10** (a document's issuer must equal the DIDComm sender) — real and
  deliberate; their unpack refuses otherwise. "Specification gap" is the
  right framing for it.

## What they found missing in us — all now work items

| # | Gap | Consequence | State |
| --- | --- | --- | --- |
| U1 | `requirementsDigest` was not sent with the submit | Their `select_criterion` reads it to decide **which** criterion the applicant gathered against; absent, it takes the first vetting criterion and records `applicant_digest_matches: false` in the vetting facts, which policy may weigh. With one criterion this is invisible — which is why our run was green. With two, we gather against one and are judged against another. | **fixed** — the submit now carries the digest of the criterion the application was built for, falling back to the manifest's |
| U2 | Grant-before-attest ordering not checked | A statement counts only if its signer held the vetter grant *before* signing. Sign first, grant second and the statement verifies perfectly and then counts for nothing — the community reports `issuer-not-vetter`, which reads like a configuration error. | **fixed** — the grant's window is recorded from the eligibility presentation at acceptance and the statement's signing time is checked against it on intake; the checklist says so |
| U3 | No revocation / grant-status check | Their applicant checks the vetter's grant and shows "not revoked when checked on …". Without it an applicant can present a statement the community discounts with no warning. | **partial** — the grant's validity window is now checked and surfaced; the live status round trip to the community is still to do |
| U4 | `maxStatementAge`, independence, commitment consistency unexercised | All are criterion knobs a real community will set; none appear in our evidence. | **open** — belongs with the negative-case rung |
| U5 | Version drift in the report | The join manifest is now readable anonymously over the community's REST trust-task route, and a community can turn that off. Asking only over DIDComm still works, but it is the slow path — and on a first join, before any channel exists, it is the impossible one. | **fixed** — the join manifest is read over the community's REST trust-task route first (`manifestOverRest`), falling back to DIDComm when that route is unreachable or turned off |

They also queried, rather than disputed, **VTI-13** ("a criterion cannot
express no requirements"): a criterion with no vetting member is how that is
said, and their console renders it as requiring no vetting — so the finding
is probably the narrower one, that `minStatements: 0` is refused. Worth
re-checking and re-wording.

**They cannot adjudicate the findings from one-line summaries.** The
numbered document is what they need; sending it is the next contact action.

## Standing guidance received

- TSP Rev 3 may be dropped if we are pressed for time: it carries a fair
  amount of relationship management of its own and has been difficult to get
  working. Our Rev 3 work is already implemented and merged behind a
  build-time switch with the peer leg defaulting to DIDComm, so the cost of
  keeping it is zero and the demo does not depend on it.
- An offer stands of test accounts on an upstream VTA, and access to a
  community service, so we can run their client against the same
  infrastructure and see both sides.

## Order of work

1. U1, U2 — done, in the tree.
2. Send the findings document upstream so the other 28 can be adjudicated.
3. U5 — manifest over REST with a DIDComm fallback (also fixes the
   first-join bootstrap).
4. U3's live status round trip, then U4 with the negative cases.
5. Take the test-account offer; run their client against our stack and ours
   against theirs.
