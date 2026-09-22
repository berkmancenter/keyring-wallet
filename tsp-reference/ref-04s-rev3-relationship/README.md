# ref-04s-rev3-relationship — a Rev 3 relationship with a lab VTA, formed and ended

Covers the parts of R5 ([`tsp_rev3_subtask.md`](../../docs/plans/keyring-on-the-vta-farm/tsp_rev3_subtask.md))
that the two-device ceremony cannot reach, against upstream's own state machine:

- **XRFI → XRFA.** The VTA answers our invite with an accept that names the
  invite's digest; its signature verifies against the VTA's authentication key.
- **XRFD.** The VTA's state machine takes a cancel naming that relationship —
  read from its own log, since a cancel answers nothing on the wire.

```sh
npm install && node run.mjs     # the lab stack in ~/vti-stack
```

The frames are `vti-tsp-js` 0.3.0's. Keyring's `packInviteRev3`,
`packAcceptRev3` and `packCancelRev3` are byte-identical to them (asserted in
bifold `packages/trust-tasks`), so what the VTA accepts here it accepts from the
phone.

Measured 2026-09-21, era H (vti `a96fe02f`):

```
  → invite 972B, digest 956f851aef7d801d…
  ← control from did:webvh:QmNu65wDKyeRe4WMGu41s6pM7JCHg2…: accept
  ✓ XRFA names our invite's digest, and its signature verified against the VTA's authentication key
  → cancel 381B naming 956f851aef7d801d…
  alice: … accepted an inbound TSP relationship request … request=Invite state=Bidirectional
  alice: … WARN … could not send a TSP relationship cancellation … reason=the peer cancelled a
         mutual relationship (§7.3) error=… invalid transition: SendCancel in state None
  ✓ the VTA's state machine took the cancel
  (no answering XRFD within 5s — §7.3 expects one; see VTI-38)
```

The warning is upstream's, and recorded as VTI-38 in `docs/VTI_UPSTREAM_FINDINGS.md`:
the transport moves the relationship to `None` on receiving the cancel and only
then reports that §7.3 expects an answer, so the answering cancel is refused.
The relationship does end on both sides.

**Not covered: the invite race** (§7.2, both sides inviting at once). No service
in the ecosystem legs initiates a relationship with a wallet, so the race cannot
arise against them; it is covered by the package's own `resolveInviteRace`.
