/**
 * Renewing a member's community cards before they lapse (IN-501).
 *
 * A community issues the membership card and the role card for 30 days, a
 * length fixed in its code (VTI vtc-service credentials/mod.rs, vac.rs), and
 * renews them only when the member asks: `vtc/members/renew/0.1`, a signed
 * document from the member, no payload (vtc-service routes/members/renew.rs).
 * Inside the community the ACL decides membership, not the card, so a lapsed
 * card blocks nothing there; it can no longer be shown outside, and the phone
 * said "Your membership ended". Before this module Keyring never asked.
 *
 * - When: once two thirds of the card's life have passed (day 20 of 30), and
 *   for a card that has already lapsed, as soon as the phone is unlocked. The
 *   community renews whatever the card's dates say (renew.rs: "no expiry
 *   check, no grace window").
 * - How: as the membership's own identity, over the shared session, in a
 *   background hold (`vtiAgent.holding`): it gives way to anything the person
 *   is doing, and is tried again later.
 * - What comes back: a new membership card and role card. Each is checked as a
 *   delivered card is (`checkDeliveredCard`) and kept on the membership in
 *   place of the old one; "Member since" stays the day the membership began.
 *   The cards are then kept by the agent (the vault picks up new cards on
 *   `VTI_PERSONA_DELIVERIES_EVENT`), and the member's acknowledgement is issued
 *   again (`reciprocateIfOwed`): the old one binds to the old card's digest.
 * - Refusals (a personhood policy that no longer admits the member, or
 *   `renew:notMember`, the community holding no membership for this identity):
 *   the card is kept as it is and asked again after `RENEW_RETRY_MS`, a pause
 *   kept on the phone so it holds across restarts. Nothing here records a
 *   membership as ended; that stays with the community's removal notice.
 *   - no answer, a session another step holds, or a card that cannot be
 *     checked now: nothing changes, and it is asked again later.
 *
 * Nothing here ever deletes or replaces a card except with a renewed one that
 * passed its check.
 *
 * @module trust-tasks/module/vtiCardRenewal
 */
import type { Agent } from '@credo-ts/core'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { sameIdentity } from './didScid'
import { membershipLockKey, withKeyLock } from './keyedRecords'
import { canSignAs } from './sharedIdentity'
import { vtaAgent } from './vtaAgent'
import { vtiAgent, VtiRefusal } from './vtiAgent'
import { deliveredCardCheck, VtiCardStatusUnreadable, type VtiDeliveredCardCheck } from './vtiDeliveredCheck'
import { classifyCredential, roleNameOf } from './vtiInbox'
import { reciprocateIfOwed } from './vtiReciprocate'
import {
  GenericRecordsCommunityStore,
  isCurrentMembership,
  type VtiCommunityStore,
  type VtiMembership,
} from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { GenericRecordsTspPeerRevisionStore } from './vtiTsp'

export const MEMBERS_RENEW = 'https://trusttasks.org/spec/vtc/members/renew/0.1'

/** Renewed once this much of a card's life has passed: day 20 of a 30-day card. */
export const RENEW_AT_FRACTION = 2 / 3
/** After an attempt that changed nothing, the same membership is not asked again for this long in one app run. */
export const RENEW_RETRY_MS = 6 * 60 * 60 * 1000
/** How often an open app looks for a card due. */
export const RENEW_LOOK_EVERY_MS = 60 * 60 * 1000
/** The first look after unlock waits this long, so it does not compete with the sign-ins of the first screens. */
export const RENEW_FIRST_LOOK_MS = 20 * 1000

const timeOf = (value: unknown): number | undefined => {
  const t = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(t) ? t : undefined
}

/**
 * Whether a membership's card is due for renewal at `now`: the membership
 * stands, and two thirds of its card's life have passed, or all of it. A card
 * that states no end is never due.
 */
export function renewalDue(membership: Pick<VtiMembership, 'vmc' | 'removal'>, now: number): boolean {
  if (!isCurrentMembership(membership)) return false
  const from = timeOf(membership.vmc?.validFrom)
  const until = timeOf(membership.vmc?.validUntil)
  if (until === undefined) return false
  if (from === undefined || from >= until) return now >= until
  return now >= from + (until - from) * RENEW_AT_FRACTION
}

export type RenewOutcome =
  /** New cards kept on the membership. */
  | 'renewed'
  /** The membership is ended, or its card not due: nothing asked. */
  | 'notDue'
  /** The community refused for another reason: the card is kept, and asked again later. */
  | 'refused'
  /** No answer, or the session was held by another step: asked again later. */
  | 'noAnswer'
  /** The answer's cards did not hold up (or could not be checked now): the card is kept, and asked again later. */
  | 'cardRefused'

export interface RenewDeps {
  store: VtiCommunityStore
  persona: Pick<VtiPersona, 'did'>
  communityDid: string
  /** Sends `vtc/members/renew/0.1` as the persona and returns the answer's payload; throws a refusal or no answer. */
  ask: () => Promise<Record<string, unknown>>
  /** Checks a card before it is kept (`deliveredCardCheck`). */
  checkCard: VtiDeliveredCardCheck
  /** After new cards are kept: the member's acknowledgement of the new grant. Best effort. */
  acknowledge?: () => Promise<unknown>
  now?: () => number
  log?: (line: string) => void
}

/**
 * Ask the community to renew this persona's cards, if due, and keep what it
 * sends. See the module comment for what each answer does.
 */
export async function renewMembershipCards(deps: RenewDeps): Promise<RenewOutcome> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => undefined)
  const { store, persona, communityDid } = deps
  const before = await store.getMembership(communityDid, persona.did)
  if (!before || before.personaDid !== persona.did || !renewalDue(before, now())) return 'notDue'

  let answer: Record<string, unknown>
  try {
    answer = await deps.ask()
  } catch (e) {
    if (e instanceof VtiRefusal) {
      // The code only: a refusal's words are the community's, and may name the member.
      log(`[VTI] card renewal refused (${e.code.split('/').pop()}); the card is kept and asked again later`)
      return 'refused'
    }
    log(`[VTI] card renewal: no answer (${e instanceof Error ? e.name : 'unknown'}); asked again later`)
    return 'noAnswer'
  }

  const vmc = answer.vmc as Record<string, unknown> | undefined
  const roleCard = (answer.roleVac ?? answer.roleVec) as Record<string, unknown> | undefined
  // Each card must be this community's, about this identity, and hold up as a delivered one does.
  const refusalOf = async (card: Record<string, unknown> | undefined, kinds: string[]): Promise<string | undefined> => {
    if (!card || typeof card !== 'object') return 'missing'
    const item = classifyCredential(card)
    if (!kinds.includes(item.kind)) return 'notThatCard'
    if (!sameIdentity(item.communityDid, communityDid)) return 'notFromCommunity'
    if (item.subjectDid !== persona.did) return 'subject'
    return deps.checkCard(card, communityDid)
  }
  let vmcRefusal: string | undefined
  let roleRefusal: string | undefined
  try {
    vmcRefusal = await refusalOf(vmc, ['membership'])
    // A role card that names a role and is about this identity: the vetter role's card reads as a vetter grant.
    roleRefusal = roleCard && roleNameOf(roleCard) ? await refusalOf(roleCard, ['role', 'vetter-grant']) : 'missing'
  } catch (e) {
    if (!(e instanceof VtiCardStatusUnreadable)) throw e
    log("[VTI] card renewal: the new card's status list could not be read; asked again later")
    return 'cardRefused'
  }
  if (vmcRefusal || !vmc) {
    log(`[VTI] card renewal: the new membership card was not kept (${vmcRefusal ?? 'missing'})`)
    return 'cardRefused'
  }

  const kept = await withKeyLock(membershipLockKey(communityDid, persona.did), async () => {
    const latest = await store.getMembership(communityDid, persona.did)
    // Ended while the renewal was asked: a removal notice stands over a renewed card.
    if (!latest || latest.personaDid !== persona.did || !isCurrentMembership(latest)) return false
    const role = !roleRefusal && roleCard ? roleCard : undefined
    await store.saveMembership({
      ...latest,
      vmc,
      // A copy of the card's own end, for the screens that read it; renewalDue reads the card's (`vmc.validUntil`).
      validUntil: typeof vmc.validUntil === 'string' ? vmc.validUntil : undefined,
      ...(role ? { roleVec: role, role: String(roleNameOf(role) ?? latest.role) } : {}),
      // "Member since" is when the membership began, not when its card was last renewed.
      grantedAt: latest.grantedAt,
    })
    return true
  })
  if (!kept) return 'notDue'
  if (roleRefusal && roleRefusal !== 'missing')
    log(`[VTI] card renewal: the new role card was not kept (${roleRefusal}); the old one stays`)
  // The cards' dates only (no identities), so a live check can read before and after from the log.
  const span = (card: Record<string, unknown> | undefined) => `${card?.validFrom ?? '?'}..${card?.validUntil ?? '?'}`
  log(
    `[VTI] card renewal: new cards kept (membership ${span(before.vmc)} -> ${span(vmc)}; role card ${
      roleRefusal ? 'old one stays' : 'renewed'
    })`
  )
  DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, {
    communityDid,
    kinds: roleRefusal ? ['membership'] : ['membership', 'role'],
  })
  const acknowledged = await deps.acknowledge?.().catch((e) => (e instanceof Error ? e.name : 'failed'))
  log(`[VTI] card renewal: acknowledgement ${typeof acknowledged === 'string' ? acknowledged : 'not sent'}`)
  return 'renewed'
}

/**
 * Where the last attempt that changed nothing is kept, per membership (`<community>|<identity>` to a time), so the
 * pause between attempts holds across app restarts: a card past day 20 stays due, and a refusal (`notMember` among
 * them) records nothing on the membership, so without this every launch would ask again.
 */
export const RENEW_TRIED_KEY = 'keyring/vti-card-renewal-tried'

export interface RenewTriedStore {
  load: () => Promise<Record<string, number>>
  save: (tried: Record<string, number>) => Promise<void>
}

const parseTried = (raw: unknown): Record<string, number> => {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : undefined
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])
      )
    )
  } catch {
    return {}
  }
}

/** The phone's own store: unreadable or unwritable, it reads as nothing tried, and the next look may ask again. */
export const storedRenewTries: RenewTriedStore = {
  load: async () => {
    try {
      return parseTried(await AsyncStorage.getItem(RENEW_TRIED_KEY))
    } catch {
      return {}
    }
  },
  save: async (tried) => {
    try {
      await AsyncStorage.setItem(RENEW_TRIED_KEY, JSON.stringify(tried))
    } catch {
      // Best effort: the pause then holds only until the next launch.
    }
  },
}

/** For tests. */
export async function resetCardRenewal(): Promise<void> {
  await storedRenewTries.save({})
}

/**
 * Renew every card due on this phone, one membership at a time. A membership
 * whose identity cannot sign now (its keys not borrowed yet, or its agent not
 * linked) is left for a later look, as is one asked within `RENEW_RETRY_MS`
 * without a change.
 */
export async function renewDueCards(
  agent: Agent,
  options: {
    mediatorDid?: string
    store?: VtiCommunityStore
    identities?: VtiIdentityStore
    now?: () => number
    renew?: (deps: RenewDeps) => Promise<RenewOutcome>
    /** Sends the renewal as `persona`; by default over the shared session in a background hold. */
    send?: (persona: VtiPersona, communityDid: string) => Promise<Record<string, unknown>>
    /** The last attempts that changed nothing; by default kept on the phone (`storedRenewTries`). */
    tries?: RenewTriedStore
  } = {}
): Promise<Record<string, RenewOutcome>> {
  const now = options.now ?? Date.now
  const store = options.store ?? new GenericRecordsCommunityStore(agent)
  const identities = options.identities ?? new GenericRecordsIdentityStore(agent)
  const renew = options.renew ?? renewMembershipCards
  const log = (line: string) => agent.config?.logger?.info?.(line)
  const linked = vtaAgent.getState().agents?.map((a) => a.vtaDid)
  const personas = await identities.listPersonas().catch(() => [] as VtiPersona[])
  const send =
    options.send ??
    ((persona: VtiPersona, communityDid: string) =>
      vtiAgent.holding(
        agent,
        options.mediatorDid,
        persona,
        () => vtiAgent.communityTask(communityDid, MEMBERS_RENEW, {}),
        {
          background: true,
          reason: 'card renewal',
          peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
        }
      ))
  const tries = options.tries ?? storedRenewTries
  const before = await tries.load()
  const memberships = await store.listMemberships().catch(() => [] as VtiMembership[])
  // Only this phone's memberships are kept, so a membership gone from it takes its entry with it.
  const tried: Record<string, number> = {}
  for (const m of memberships) {
    const key = `${m.communityDid}|${m.personaDid}`
    if (before[key] !== undefined) tried[key] = before[key]
  }
  const outcomes: Record<string, RenewOutcome> = {}
  for (const membership of memberships) {
    if (!renewalDue(membership, now())) continue
    const key = `${membership.communityDid}|${membership.personaDid}`
    const last = tried[key]
    // A time ahead of the clock (the clock was set back) does not hold the pause.
    if (last !== undefined && last <= now() && now() - last < RENEW_RETRY_MS) continue
    const persona = personas.find((p) => p.did === membership.personaDid)
    // An identity this phone cannot sign as, or one held through an agent no longer linked, waits.
    if (!persona || !canSignAs(persona) || (linked && persona.vtaDid && !linked.includes(persona.vtaDid))) continue
    const outcome = await renew({
      store,
      persona,
      communityDid: membership.communityDid,
      ask: () => send(persona, membership.communityDid),
      checkCard: deliveredCardCheck(agent),
      // Over the session as this identity: the acknowledgement must be signed by it.
      acknowledge: () =>
        vtiAgent.holding(
          agent,
          options.mediatorDid,
          persona,
          () => reciprocateIfOwed(agent, store, persona, membership.communityDid),
          { background: true, reason: 'card renewal acknowledgement' }
        ),
      now,
      log,
    }).catch((e) => {
      agent.config?.logger?.warn?.(`[VTI] card renewal: ${e instanceof Error ? e.name : 'failed'}`)
      return 'noAnswer' as const
    })
    outcomes[key] = outcome
    if (outcome === 'renewed') delete tried[key]
    else tried[key] = now()
  }
  if (JSON.stringify(tried) !== JSON.stringify(before)) await tries.save(tried)
  return outcomes
}

/** Renew cards that are due: shortly after unlock, then every hour while the app is open. */
export function useVtiCardRenewal(agent: Agent | undefined, mediatorDid?: string): void {
  useEffect(() => {
    if (!agent) return
    let running = false
    const run = () => {
      if (running) return
      running = true
      void renewDueCards(agent, { mediatorDid })
        .catch((e) => agent.config?.logger?.warn?.(`[VTI] card renewal: ${(e as Error)?.message ?? e}`))
        .finally(() => {
          running = false
        })
    }
    const first = setTimeout(run, RENEW_FIRST_LOOK_MS)
    const every = setInterval(run, RENEW_LOOK_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [agent, mediatorDid])
}
