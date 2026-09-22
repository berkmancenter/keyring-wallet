/**
 * vtiJoin — joining a community as a persona the wallet's VTA holds.
 *
 * The one place the two legs meet. `VtaClient` (phone ↔ its VTA) supplies the
 * persona and its borrowed key; `vtiAgent` (phone ↔ community) presents it.
 * The steps are named so a screen can show them and a test can assert them,
 * and every side effect goes through the two stores, never straight to Credo.
 *
 *   ensure persona → connect as it → manifest → submit (with the invitation,
 *   when there is one) → verdict → on `allow`, keep the card.
 *
 * @module trust-tasks/module/vtiJoin
 */

import type { Agent } from '@credo-ts/core'

import { vtaAgent } from './vtaAgent'
import type { VtiCommunityStore, VtiInvitation, VtiMembership } from './VtiCommunityStore'
import type { VtiIdentityStore, VtiPersona } from './VtiIdentityStore'
import { vtiAgent, type VtiVerdict } from './vtiAgent'
import { receiveIssue } from './vtiInbox'
import { GenericRecordsTspPeerRevisionStore } from './vtiTsp'

export type VtiJoinStep =
  | 'persona'
  | 'connecting'
  | 'manifest'
  | 'submitting'
  | 'verdict'
  | 'stored'

export interface VtiJoinDeps {
  agent: Agent
  identityStore: VtiIdentityStore
  communityStore: VtiCommunityStore
  /** The phone's VTA and the mediator the community is reached through. */
  vtaDid: string
  mediatorDid: string
  communityDid: string
  onStep?: (step: VtiJoinStep, detail?: string) => void
}

export interface VtiJoinResult {
  persona: VtiPersona
  verdict: VtiVerdict
  membership?: VtiMembership
}

/**
 * The persona this wallet presents to a community — reused when one exists,
 * minted on the VTA (and its key-agreement key borrowed) when not. One
 * identity per community, kept: a person is recognised by it afterwards.
 */
export async function ensurePersonaFor(deps: Pick<VtiJoinDeps, 'agent' | 'identityStore' | 'vtaDid' | 'communityDid'>): Promise<VtiPersona> {
  // The app's one session with its VTA: a granted notice must reach the
  // client that waits for it, and a second socket for the same DID would not.
  const client = vtaAgent.client(deps.agent, deps.vtaDid, deps.identityStore)
  return client.ensurePersona({ communityDid: deps.communityDid })
}

export async function joinCommunity(deps: VtiJoinDeps, invitation?: VtiInvitation): Promise<VtiJoinResult> {
  const step = (s: VtiJoinStep, d?: string) => deps.onStep?.(s, d)

  step('persona')
  const persona = await ensurePersonaFor(deps)
  if (!persona.kmsKeyIds?.keyAgreement) throw new Error('vtiJoin: the persona has no borrowed key-agreement key')
  if (invitation && invitation.subjectDid !== persona.did) {
    throw new Error(`vtiJoin: the invitation is for ${invitation.subjectDid}, not this persona`)
  }

  step('connecting', persona.did)
  await vtiAgent.connect(deps.agent, deps.mediatorDid, { persona, peerRevisionStore: new GenericRecordsTspPeerRevisionStore(deps.agent) })

  // Whatever the community delivers during the join — on the Eucalyptus
  // train the card and the role arrive as separate messages after the verdict.
  const via = invitation ? 'invitation' : 'approval'
  const stopInbox = vtiAgent.onInbound((plaintext) => {
    void receiveIssue(deps.communityStore, persona.did, plaintext, { via }).catch(() => undefined)
  })

  step('manifest')
  const manifest = await vtiAgent.fetchManifest(deps.communityDid)

  step('submitting', invitation ? 'with invitation' : 'empty')
  const verdict = await vtiAgent.apply(deps.communityDid, manifest, {
    credentials: invitation ? [invitation.credential] : [],
  })
  step('verdict', verdict.effect)

  let membership: VtiMembership | undefined
  try {
    if (verdict.effect === 'allow') {
      membership = membershipFromVerdict(deps.communityDid, persona.did, verdict, via)
      if (membership) {
        await deps.communityStore.saveMembership(membership)
      } else {
        // The card comes by delivery, not inline: give the outbox a moment.
        for (let i = 0; i < 20 && !membership; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          membership = await deps.communityStore.getMembership(deps.communityDid)
        }
      }
      if (membership) {
        if (invitation) await deps.communityStore.saveInvitation({ ...invitation, status: 'used' })
        step('stored', membership.role)
      }
    }
  } finally {
    // Keep listening a little longer: the role endorsement can trail the card.
    setTimeout(stopInbox, 30000)
  }
  return { persona, verdict, membership }
}

/** The card an `allow` carries inline: `with.vmc` and, when granted, `with.roleVec`. */
export function membershipFromVerdict(
  communityDid: string,
  personaDid: string,
  verdict: VtiVerdict,
  via: VtiMembership['via']
): VtiMembership | undefined {
  const w = (verdict.with ?? {}) as { vmc?: Record<string, unknown>; roleVec?: Record<string, unknown> }
  if (!w.vmc) return undefined
  const roleSubject = (w.roleVec?.credentialSubject as { endorsement?: { role?: string } } | undefined)?.endorsement
  return {
    communityDid,
    personaDid,
    role: roleSubject?.role ?? 'member',
    vmc: w.vmc,
    roleVec: w.roleVec,
    grantedAt: typeof w.vmc.validFrom === 'string' ? w.vmc.validFrom : new Date().toISOString(),
    validUntil: typeof w.vmc.validUntil === 'string' ? w.vmc.validUntil : undefined,
    via,
  }
}
