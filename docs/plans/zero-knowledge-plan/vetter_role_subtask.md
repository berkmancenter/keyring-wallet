# Vouching in hidden mode — the vetter role on the phone

**Status:** proposed, not started. **Owner:** this plan's §4.1 (Track Z1), decision
**D3**. **Parent:** [`../zero-knowledge-plan.md`](../zero-knowledge-plan.md).

**Why this document exists.** The applicant side is built: a Keyring user can be
vouched for anonymously and prove it to a community (see
[`keyring_implementation_subtask.md`](./keyring_implementation_subtask.md)). A Keyring
user **cannot vouch** — and the reason recorded in the parent plan for not building it
was **wrong**. Alberto put it as *"seems we are only working half way, the applicant
side"*, and that is the right reading.

## 1. The claim that blocked this, and why it fell

The parent's §3.1 point 2 said hidden vetting needs an always-on agent, because an
anonymous vetter's rate-limiting tokens must be drawn on a schedule that does not track
their activity, and a mobile OS suspends and kills apps as routine.

**[[PCS-DESIGN]] §5.1 step 1 answers that directly:**

> Fetches are **scheduled and unconditional**, at a random moment within the tick window.
> They carry no information about use.
>
> **Missed ticks** (the device was off) are caught up on the next fetch, capped at
> `r × W`. This reveals when the vetter was offline, not when they vetted. A community
> that minds can have the vetter's always-on agent do the fetching.

So:

- **A sleeping device is a designed-for case**, not an excluded one. Catch-up is the
  mechanism.
- **The residual leak is offline-ness, not vouching** — and vouching is what the drip
  exists to hide.
- **The always-on agent is an option a community may require**, not a precondition.

And the comparison that made the original claim look safe does not hold: **`openvtc` has
no daemon.** The drip appears only in its TUI's vetting panel, so the reference client
draws when its operator has it open. A phone is not worse than the client this design was
written against.

## 2. What is actually true about the phone, now it has been checked

| Concern | Finding |
|---|---|
| Keeping the spend record | `VetterSnapshot` derives `Serialize`/`Deserialize`, camelCase, `deny_unknown_fields` — exactly like the applicant's state. The Keychain route of the parent's §3.4 carries it unchanged |
| Two copies leaking | Real, and it argues *for* the phone: `snapshot.rs:109-111` calls `usk` *"the most sensitive value here: every tag this vetter has ever produced is derived from it, so a copy links their attestations to each other"*. **One** holder is what the construction wants, and a phone holding the only copy is that |
| The engine | `vetter::VetterEngine` is in the **same published crate** as `applicant::ApplicantEngine`, which this wallet already bridges |
| Proving cost | The vetter attests rather than proves a threshold; `ref-32` measured attest at **33 ms** on a low-end Android, against 87 ms to prove. Cheaper than the side already built |

**So this is work, not an impossibility.** That is the whole correction.

## 3. What it would take

1. **Bridge the vetter engine.** Add to `@bifold/react-native-pcs` the flat equivalents of
   what the applicant side already has: enrol (a blind root-credential request), draw
   tokens for a tick, reserve on accepting a request, attest, release on decline. The
   surface stays snapshot-in/snapshot-out, for the same reasons.
2. **Two new community tasks**, both published and both vetter-called:
   `vtc/vetting/vetters/pcs-root/0.1` (blind-sign the class credential for a period) and
   `vtc/vetting/vetters/pcs-tokens/0.1` (draw the tick's tokens). The parent's §8 B2 lists
   them; `pcsChallenge` is the worked example of how such a task is added.
3. **The catch-up discipline.** Draw on every launch for every tick owed, capped at
   `r × W`, unconditionally — never because a request arrived, which is precisely the
   signal the drip hides. This is the one piece with no analogue on the applicant side and
   the one most easily got wrong.
4. **Storage** for `VetterSnapshot`, beside the applicant's: its own Keychain service, and
   **never two copies**.
5. **The desk's screens**, which mostly exist: the hidden variant returns an attestation
   instead of a named statement and must show the at-capacity decline the engine already
   produces ("next free token from tick 2", `ref-27`).

## 4. What to decide before any of it

- **Does Keyring need the vetter role?** A community can run hidden vetting with Keyring
  applicants and non-Keyring vouchers today. The feature is worth building if we expect a
  community whose vouchers are phone users — which is the ordinary case for the
  communities this wallet is for, so the answer is probably yes.
- **Is the offline-ness leak acceptable to us?** The design says a community that minds
  can require an agent. We should not pretend the phone is equivalent: it leaks *when the
  vetter was offline*. For a volunteer voucher that is likely to be acceptable, and it is
  the community's call, not ours.

## 5. What this does not change

Nothing already built. The applicant path stands as it is, and the vetter role is additive.
