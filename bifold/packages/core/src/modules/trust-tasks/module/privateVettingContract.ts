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
import type { VtiCriterion } from './joinManifest'

/**
 * Whether the criterion an application is gathering for is a private way this
 * build can carry: it publishes `org.openvtc.hidden-vetting`, in the suite
 * agents implement, and the ext is not critical in a way this build cannot
 * honour. Decided from the criterion alone — no agent round trip, because this
 * is asked on every render.
 *
 * It does **not** ask whether this phone may use it; that is the agent's
 * answer (`hiddenVettingUsable`) and costs a call, so it is asked when the
 * person acts, not when a screen draws.
 */
export declare function privateMode(criterion: VtiCriterion | undefined): boolean

/**
 * `checklist()` keeps the named shape exactly, and grows one member.
 *
 * The mapping in private mode, which is the whole of what the screen needs to
 * know: `held` is attestations taken, `counted` those the agent accepted,
 * `discounted` those it refused, `needed` the criterion's `minStatements`, and
 * `meets` is `counted >= needed`. `statements` is empty — there are none to
 * show, and rows invented from attestations would claim more than we know.
 * `independenceOk` is true with no `exceededCaps`: a community that cannot see
 * who vouched cannot apply a relationship cap, which is a property of hidden
 * vetting rather than a gap in this client.
 *
 * `mode` is absent for named vetting, so every existing reader is unaffected.
 */
export type VettingChecklistMode = { mode?: 'private' }

/**
 * What a vetter's desk request gains when its `vetting/request` carried the
 * hidden-vetting ext.
 *
 * `hiddenApplicantId` already carries the applicant's PCS identifier; `hidden`
 * is derived from it so a screen never has to know what that id means, and
 * nothing should key behaviour on the id itself.
 */
export type VettingDeskRequestPrivacy = { hidden?: boolean }

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
