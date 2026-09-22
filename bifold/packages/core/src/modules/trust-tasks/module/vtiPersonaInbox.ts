/**
 * What a community sends a persona, collected wherever the person is in the app.
 *
 * A vetter grant, a membership, an invitation's issue — each arrives as a
 * message to the persona's DID, and the mediator holds it until a session for
 * that DID collects it. Until 2026-09-22 only the Vetting screen and a join
 * in flight opened that session, so a grant issued while the person was
 * elsewhere sat at the mediator: the seat stayed "being vetted" until they
 * happened to open Vetting (measured: the community's outbox sent it, and the
 * phone showed nothing until Vetting was opened once).
 *
 * `startPersonaInbox` keeps the persona's session open from unlock and stores
 * what arrives, the same way Vetting does. It never takes the session from
 * anything else: `vtiAgent` holds one session, so when some flow has opened it
 * (a join, Vetting, a community connect) the inbox only listens, and it
 * reconnects as the persona only when nothing is open.
 */
import type { Agent } from '@credo-ts/core'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { receiveIssue, type VtiReceivedCredential } from './vtiInbox'
import { vtiAgent } from './vtiAgent'
import { GenericRecordsTspPeerRevisionStore } from './vtiTsp'

/** Emitted with `{ communityDid, kinds }` whenever the inbox stores something. */
export const VTI_PERSONA_DELIVERIES_EVENT = 'vti:persona-deliveries'

export interface PersonaInboxOptions {
  mediatorDid: string
  /** The community whose persona to listen as; the most recent persona when absent. */
  communityDid?: string
  /** How often to look again for a persona or a closed session. */
  intervalMs?: number
  onError?: (error: unknown) => void
}

async function personaFor(agent: Agent, communityDid?: string): Promise<VtiPersona | undefined> {
  const identity = new GenericRecordsIdentityStore(agent)
  if (communityDid) return (await identity.getPersona(communityDid)) ?? undefined
  const all = await identity.listPersonas()
  return all.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
}

/** Start collecting; returns the function that stops it. */
export function startPersonaInbox(agent: Agent, options: PersonaInboxOptions): () => void {
  const community = new GenericRecordsCommunityStore(agent)
  const peerRevisionStore = new GenericRecordsTspPeerRevisionStore(agent)
  let persona: VtiPersona | undefined
  let stopped = false
  let busy = false

  // Registered before any connect: opening the session drains what the
  // mediator held, and a listener attached after the connect misses that
  // backlog for good (the measurement in VtiVetting's inbox effect).
  const stopListening = vtiAgent.onInbound((message) => {
    const target = persona
    if (!target) return
    void receiveIssue(community, target.did, message)
      .then((got: VtiReceivedCredential[]) => {
        if (got.length) {
          DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, {
            communityDid: target.communityDid,
            kinds: got.map((c) => c.kind),
          })
        }
      })
      .catch((e) => options.onError?.(e))
  })

  const tick = async () => {
    if (stopped || busy) return
    busy = true
    try {
      persona = await personaFor(agent, options.communityDid)
      if (!persona?.kmsKeyIds?.keyAgreement) return
      // Only when nothing holds the session: never take it from a flow that
      // opened it on purpose.
      const { status } = vtiAgent.getState()
      if (vtiAgent.isConnected || status === 'resolving' || status === 'authenticating') return
      await vtiAgent.connect(agent, options.mediatorDid, { persona, peerRevisionStore })
    } catch (e) {
      options.onError?.(e)
    } finally {
      busy = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), options.intervalMs ?? 30_000)
  return () => {
    stopped = true
    clearInterval(timer)
    stopListening()
  }
}

/** Run the persona inbox while the app is unlocked and an agent exists. */
export function useVtiPersonaInbox(agent: Agent | undefined, options: Partial<PersonaInboxOptions>): void {
  const { mediatorDid, communityDid, onError } = options
  useEffect(() => {
    if (!agent || !mediatorDid) return
    return startPersonaInbox(agent, { mediatorDid, communityDid, onError })
  }, [agent, mediatorDid, communityDid, onError])
}

/** Call `refresh` whenever the inbox stores something (for `communityDid`, when given). */
export function useVtiPersonaDeliveries(refresh: () => void, communityDid?: string): void {
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, (e: { communityDid?: string }) => {
      if (!communityDid || !e?.communityDid || e.communityDid === communityDid) refresh()
    })
    return () => sub.remove()
  }, [refresh, communityDid])
}
