/**
 * The shared-connect decisions that belong to Alberto (docs/plans/
 * relationship-over-tsp-plan.md §8), each taken here at the plan's recommended
 * default and kept in this one file so that changing one is a one-line edit.
 * Nothing below is agreed; the pull request lists each as an assumption.
 *
 * @module trust-tasks/module/sharedConnectDecisions
 */

import type { VrcProfile } from '../../vrc/vrc-manager'

/**
 * Decision 2, the TSP revision Keyring packs toward ecosystem peers: `1.0`
 * (keyring-wallet #853, decided 2026-11-06: both counterparts send 1.0). The
 * codec packs Rev 3 unless told `v1`, and a 1.0 reader (vti-tsp-js,
 * affinidi-tsp) drops a Rev 3 frame without a word, so this path must pass
 * `v1` on every send, the XRFI included. `rev3` stays selectable for a
 * Keyring-to-Keyring test.
 */
export const SHARED_CONNECT_TSP_REVISION: 'rev3' | '1.0' = '1.0'

/**
 * Decision 3, the key that signs each document's proof. Default
 * `issuer-vid`: the encounter VID, which matches the TSP sender, with either
 * key accepted inbound. The alternative, `relationship-did`, is what the
 * connection ceremony signs with today (`ceremony.ts` signDocumentProof).
 */
export const SHARED_CONNECT_PROOF_SIGNER: 'issuer-vid' | 'relationship-did' = 'issuer-vid'

/**
 * Decision 4, the credential profile toward non-Keyring peers, selected by
 * path rather than by the peer's RCE announcement (plan D4). Default: VCDM
 * 2.0, Data Integrity, `eddsa-jcs-2022`, no `validUntil`, no hardware
 * `evidence` (smaller frames toward RLTP). Applied by `sharedConnectCredential`.
 */
export const SHARED_CONNECT_VRC_PROFILE: VrcProfile = {
  vc20: true,
  dataIntegrity: true,
  suite: 'eddsa-jcs-2022',
  validUntil: false,
  evidence: false,
}

/**
 * Decision 1, whether the flow uses `propose/0.1` and `issue/0.1` unchanged
 * with a `ceremony` member on every step. Default: yes. The ceremony
 * definition is not published, so neither it nor a `definitionDigest` is sent
 * (plan D7; the envelope schema requires the digest with the definition).
 * Kept for when it is.
 */
export const SHARED_CONNECT_CEREMONY_DEFINITION = 'https://trusttasks.org/ceremony/shared-connect/0.1'

/**
 * Decision 5, who owns the flow on the reader side (VTI-LNK-046): default is
 * core, behind the developer flag, rather than a demo profile registered
 * through `registerTrustTask`.
 */
export const SHARED_CONNECT_FLOW_OWNER: 'core' | 'demo-profile' = 'core'

/**
 * Timing, in milliseconds (plan WP10). The wait for a `propose#response` or a
 * receipt, how often the document is re-sent in that time, and the grace after
 * `_exp` for which an already-started encounter stays open.
 */
export const SHARED_CONNECT_ANSWER_WAIT_MS = 2 * 60 * 1000
export const SHARED_CONNECT_SEND_ATTEMPTS = 2
export const SHARED_CONNECT_EXP_GRACE_MS = 5 * 60 * 1000

/**
 * Keyring as the inviter (plan WP9), decided by Alberto on 2026-11-07.
 *
 * The relay a code this phone shows names, by DID: the ic3 mediator, where the live interop runs worked
 * (mediator.ic3.dev). The scanner mints its own encounter DID on this same relay, which avoids the cross-operator
 * TSP failure (plan §3.3).
 */
export const SHARED_CONNECT_INVITER_MEDIATOR_DID =
  'did:webvh:QmVeszezSFYBaALnaTpwAasz7C29Hgah7U6EeQWyazBUq5:dids.ic3.dev:ic3-mediator'

/**
 * How long a code lives, in seconds: ten minutes, the most a shown code may (plan §2.1). The screen may ask for less.
 */
export const SHARED_CONNECT_INVITE_TTL_SECONDS = 600

/**
 * The work one code may cost (§2.8's spam bound): relationship invites answered from at most this many distinct
 * scanners, and one accepted propose. A scanner re-sending (a dropped socket, a re-scan) uses no new slot: its
 * invite is answered again and the same propose is the same acceptance.
 */
export const SHARED_CONNECT_INVITE_MAX_INVITES = 8

/**
 * The work one code may cost, in frames (§2.8's spam guard, the half the scanner and acceptance bounds above do not
 * cover): every frame that reaches the code is counted, and written, before it is opened. Below this every propose
 * costs the same work, so a failing code still looks like a spent one. The first frame past it is dropped unopened,
 * which is the same nothing every other drop shows, and the code ends (`exhausted`) so the person is told to make a
 * new one rather than watch a code that no longer answers.
 *
 * The number rests on the worst legitimate case, counting the frames that open to nothing too:
 *   8 scanners × (XRFI + propose), each re-sent once                     32
 *   the accepted scanner's receipt and issue, each re-sent once           4
 *   every one of those delivered twice by the relay (VTI-24 duplicates)   ×2 → 72
 *   frames that open to nothing (a cancel, an unreadable frame), say      8
 * About 80; the budget leaves room above that and stays finite.
 */
export const SHARED_CONNECT_INVITE_MAX_FRAMES = 128
