/**
 * Where a join request at a `did:webs` community stands, looked at while the person is elsewhere in the app.
 *
 * Nothing reads a request's status on a timer: a screen coming into view does, and Check again. A person who sends a
 * request and leaves the join page learns it was approved only by coming back, and a community that does not send the
 * card on approval (the SEDI VTC, 11-17: `credentialsDelivered: false`, report K2QJ-Z9G9) leaves them without one
 * until they tap Check again (3K8Y-BHKN).
 *
 * For a `did:webs` community ONLY (`watchesJoin`): while this phone holds an open request there, or an approved one
 * with no card, it asks where the request stands every `JOIN_WATCH_EVERY_MS`, and asks for the card once per request
 * when a look after the approval still finds none (`askForCardIfOwed`, with its own guards: only after the community
 * itself says `credentialsDelivered: false`). "Once" is per run of the watch: what it has asked is kept in memory
 * only, so after a restart it may ask once more, behind the same guard. A `did:webvh` community is never looked at
 * from here: its requests are read exactly as before.
 *
 * A community that answers that it holds no such request (`notFound`) is believed, as a screen's own read believes
 * it: the request is recorded as lost, the person is told they can send again, and the watch asks nothing more for
 * it. Only that explicit answer does this; no answer, a timeout or any other refusal keeps what the phone knew.
 *
 * Each ask goes over the identity's OWN session (`vtiAgent.status` with `as`), or over the shared session only when
 * it already is that identity: this never signs in and never takes the session from anything. With neither, the look
 * is skipped until the next one.
 */
import type { Agent } from '@credo-ts/core'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { didPrefix } from './didPrefix'
import { isJoinWatchOn } from './joinWatchSwitch'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { vtiAgent, VtiNoOwnSession, type JoinRequestStatus } from './vtiAgent'
import { askForCardIfOwed, readJoinState, type StatusPoll } from './vtiJoin'

/** How often an open request at a watched community is asked about. */
export const JOIN_WATCH_EVERY_MS = 5_000

/**
 * The longest a community that failed or did not answer is left alone. After each look that fails, the wait before
 * the next doubles (5 s, 10 s, 20 s, 40 s, then this), and a look that is answered puts it back: many phones watching
 * one community do not keep asking it at full rate while it is down or slow.
 */
export const JOIN_WATCH_REST_MAX_MS = 60_000

/** The communities whose requests are watched: `did:webs` only, and none while the switch is off (joinWatchSwitch). */
export const watchesJoin = (communityDid: string | undefined): boolean =>
  isJoinWatchOn() && typeof communityDid === 'string' && communityDid.startsWith('did:webs:')

/** One status ask as `persona`, which never signs in; throws `VtiNoOwnSession` when no session of its own is open. */
export type StatusAs = (
  persona: VtiPersona,
  communityDid: string,
  options: { requestId?: string; resendCredentials?: boolean }
) => Promise<JoinRequestStatus | undefined>

const statusWithoutSignIn: StatusAs = (persona, communityDid, options) => {
  // The shared session is this identity already: its own listener stepped aside for it (vtiIdentityListeners).
  if (vtiAgent.isConnected && vtiAgent.getState().did === persona.did) return vtiAgent.status(communityDid, options)
  return vtiAgent.status(communityDid, { ...options, as: persona })
}

export interface JoinWatchOptions {
  intervalMs?: number
  communityStore?: VtiCommunityStore
  identityStore?: VtiIdentityStore
  statusAs?: StatusAs
}

export function startJoinWatch(agent: Agent, options: JoinWatchOptions = {}): () => void {
  const identities = options.identityStore ?? new GenericRecordsIdentityStore(agent)
  const store = options.communityStore ?? new GenericRecordsCommunityStore(agent)
  const statusAs = options.statusAs ?? statusWithoutSignIn
  const stores = { communityStore: store, identityStore: identities }
  const said = (communityDid: string, line: string) =>
    agent.config?.logger?.info?.(`[VTI] join watch (${didPrefix(communityDid)}): ${line}`)

  let stopped = false
  let busy = false
  /** The watched communities this phone holds an identity for; read at the start and when a community changes. */
  let watched: string[] = []
  /** Requests seen approved with no card at an earlier look, and those the card was asked for (once each). */
  const seenApproved = new Set<string>()
  const askedForCard = new Set<string>()
  /** Per community, after a look that failed: how many in a row, and when it may be looked at again. */
  const resting = new Map<string, { fails: number; until: number }>()

  const arm = async (): Promise<void> => {
    const personas = await identities.listPersonas().catch(() => [] as VtiPersona[])
    if (!stopped) watched = [...new Set(personas.map((p) => p.communityDid).filter(watchesJoin))]
  }

  const look = async (communityDid: string): Promise<void> => {
    const here = await readJoinState(agent, communityDid, { local: true, ...stores })
    if (here.kind !== 'sent' && here.kind !== 'pending') return
    const persona = await identities.getPersona(communityDid)
    if (!persona) return
    // readJoinState keeps what the phone knew when its poll fails, and says nothing: the failure is kept here, so a
    // community that did not answer is left alone for longer (`resting`).
    let failed: unknown
    const status: StatusPoll = (did, requestId, ask = {}) =>
      statusAs(persona, did, { requestId, ...(ask.resendCredentials ? { resendCredentials: true } : {}) }).catch(
        (e) => {
          failed = e
          throw e
        }
      )
    const key = `${communityDid} ${here.submission.sentAt}`
    if (here.kind === 'pending' && here.submission.status === 'approved') {
      // Approved, no card held. The community's own delivery gets one look's time first; then asked for once.
      if (!seenApproved.has(key)) return void seenApproved.add(key)
      if (askedForCard.has(key)) return
      askedForCard.add(key)
      const asked = await askForCardIfOwed(agent, communityDid, { ...stores, status }).catch((e) => {
        // Not asked after all (no session of its own just now, or no answer): the next look may.
        askedForCard.delete(key)
        throw e
      })
      said(communityDid, `approved with no card: asked for it${asked.resend ? ` (${asked.resend})` : ', not needed'}`)
      return
    }
    // Open: ask where it stands. What it says is stored, and the screens read it from there (recordStatus).
    const before = here.submission.status
    const after = await readJoinState(agent, communityDid, { ...stores, status })
    const now = after.kind === 'sent' || after.kind === 'pending' ? after.submission.status : after.kind
    if (now !== before) said(communityDid, `the request is now ${now ?? 'open'}`)
    // Approved at this look: the card gets until the next one to come by itself.
    if (after.kind === 'pending' && after.submission.status === 'approved') seenApproved.add(key)
    if (failed) throw failed
  }

  const tick = async (): Promise<void> => {
    if (stopped || busy || watched.length === 0 || !isJoinWatchOn()) return
    busy = true
    try {
      for (const communityDid of watched) {
        if (stopped) return
        if ((resting.get(communityDid)?.until ?? 0) > Date.now()) continue
        await look(communityDid).then(
          () => void resting.delete(communityDid),
          (e) => {
            // No session of its own yet is the ordinary case right after a launch: nothing was asked, nothing to say.
            if (e instanceof VtiNoOwnSession) return
            const fails = (resting.get(communityDid)?.fails ?? 0) + 1
            const rest = Math.min(JOIN_WATCH_EVERY_MS * 2 ** fails, JOIN_WATCH_REST_MAX_MS)
            resting.set(communityDid, { fails, until: Date.now() + rest - JOIN_WATCH_EVERY_MS / 2 })
            said(communityDid, `not looked at: ${(e as Error)?.message ?? e}; next look in ${rest / 1000} s`)
          }
        )
      }
    } finally {
      busy = false
    }
  }

  const onChange = (e?: { communityDid?: string }) => {
    if (!e?.communityDid || watchesJoin(e.communityDid)) void arm()
  }
  const subs = [
    DeviceEventEmitter.addListener(COMMUNITY_CHANGED_EVENT, onChange),
    DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, onChange),
  ]
  void arm()
  const timer = setInterval(() => void tick(), options.intervalMs ?? JOIN_WATCH_EVERY_MS)
  return () => {
    stopped = true
    clearInterval(timer)
    subs.forEach((s) => s.remove())
  }
}

/** Run the join watch while the app is unlocked and an agent exists. */
export function useVtiJoinWatch(agent: Agent | undefined): void {
  useEffect(() => {
    if (!agent) return
    return startJoinWatch(agent)
  }, [agent])
}
