/**
 * The contract for private vetting inside the ordinary vetting flow.
 *
 * Alberto, 2026-10-15: the vetting flow must be the **same** as named vetting.
 * Only the zero-knowledge part changes, it lives on the agent, it is detected
 * from state, and there are no separate screens and no repeated steps. So this
 * file declares no new flow. It states which existing members of
 * `VtiApplicant` and `VtiVetterDesk` gain private behaviour, and the one new
 * member each shape grows, so the screens can be written against it before the
 * bodies exist.
 *
 * Nothing here is a new call for a screen to make. A screen keeps calling
 * `start`, `requestVetter`, `checklist`, `submit`, `attest` and `decline`, and
 * the module decides privately whether this community's way in is hidden.
 *
 * @module trust-tasks/module/privateVettingContract
 */
/**
 * There is deliberately **no** `privateMode(criterion)` for a screen to call.
 *
 * An earlier draft of this contract declared one. Implementing it showed the
 * screen should not be asking: private mode is state, not a question about a
 * criterion. `VtiApplicant.start` creates the agent-side application when the
 * criterion publishes parameters this build can carry, and the presence of
 * that record is what private means from then on. A screen that re-derived it
 * from the criterion could disagree with the module about an application
 * already under way — exactly the kind of split Alberto's one-flow
 * instruction is meant to remove.
 *
 * A screen that needs to know reads `checklist().mode`, which comes from the
 * same state the module acts on.
 *
 * `hiddenParametersOf(criterion)` (module/hiddenVetting.ts) is still there for
 * the Join card, which genuinely has only a criterion and no application yet.
 */
export type PrivateModeIsState = never

// The checklist's private mode is declared by `checklist()`'s own return
// type, which is the contract; a separate type here was a second place to
// disagree with it.

// A private desk request is told by `isPrivateVettingRequest` (vtiVetting),
// which reads `hiddenApplicantId`. A `hidden` member was declared here once
// and never set; a screen cast to it read undefined forever (build 260).

/**
 * The steps that change behind the existing members, stated so the screens'
 * authors can see where a private application differs:
 *
 * - `start()` also creates the agent-side PCS application
 *   (`vta/pcs/applications/create`) and keeps its record beside the named one.
 *   One tap, two records.
 * - `requestVetter()` takes the same input and adds the hidden-vetting ext to
 *   the request it sends, naming the applicant's PCS id rather than the join
 *   DID, because a vetter attests to the PCS identity.
 * - an inbound `vetting/attestation` is handed to the agent
 *   (`vta/pcs/verify-attestation`) and counted. It is never stored as a
 *   statement: it is not one, and storing it beside who sent it would undo the
 *   privacy the exchange exists for.
 * - `submit()` reads the community's challenge
 *   (`vtc/vetting/pcs-challenge`), asks the agent to prove
 *   (`vta/pcs/prove`), and sends the join request with the proof in place of
 *   the statements. **It refuses locally when too few attestations have been
 *   counted**, with `prove:noUsableAttestation`, rather than spending a round
 *   trip to be told so — on 2026-10-15 a submit at 0 of 1 asked the agent to
 *   prove and sat waiting.
 * - the vetter's `attest()` sends a PCS attestation for a hidden request and
 *   the ordinary statement for a named one, from the same screen input.
 * - enrolling and drawing tokens happen **inside the desk**, on `listen()` and
 *   when a hidden request arrives — not behind a screen someone has to find.
 *   On 2026-10-15 a vetter held the right grant from the right community and
 *   never enrolled, because enrolment lived on a screen he never opened.
 */
export type PrivateVettingNotes = never
