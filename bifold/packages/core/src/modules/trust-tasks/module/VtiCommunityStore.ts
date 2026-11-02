/**
 * VtiCommunityStore — what this wallet holds *about* communities: the
 * invitations it has been handed and the memberships it has been granted.
 *
 * Kept apart from `VtiIdentityStore` (which DIDs the wallet presents) on
 * purpose: an identity can exist with no community, and a membership card
 * outlives the session that earned it. Both stores are interfaces so the
 * Credo-records implementation can be swapped for another without touching
 * the join flow or the screens.
 *
 * A membership is the pair of credentials an `allow` verdict carries inline
 * (`verdict.with.vmc`, the membership credential, and `verdict.with.roleVec`,
 * the role endorsement — measured in ref-20) or that
 * `credential-exchange/issue/0.1` delivers later. The card the Wallet shows
 * is drawn from these; they are stored verbatim so a verifier can be shown
 * exactly what the community signed.
 *
 * @module trust-tasks/module/VtiCommunityStore
 */

import type { Agent } from '@credo-ts/core'

import { type CommunityBrandRecord, httpsLogoUrl, normalisedAccent } from './communityBrand'
import { changeOfHeldCredential, emitCommunityBrandSaved, emitCommunityChanged } from './communityChanged'
import { currentAgentDid } from './currentAgent'
import { heldByAgent } from './heldByAgent'
import { listKeyed, putKeyed } from './keyedRecords'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'

export interface VtiInvitation {
  /** The invitation credential's own id. */
  id: string
  /** The community that issued it (the credential's issuer). */
  communityDid: string
  /** The DID it was issued to — the persona that must present it. */
  subjectDid: string
  role: string
  /** The `InvitationCredential` verbatim, to be presented on join. */
  credential: Record<string, unknown>
  receivedAt: string
  validUntil?: string
  status: 'pending' | 'used' | 'declined'
}

export interface VtiMembership {
  communityDid: string
  /** The persona that holds the membership. */
  personaDid: string
  role: string
  /** `MembershipCredential`, verbatim. */
  vmc: Record<string, unknown>
  /** `EndorsementCredential` for the role, verbatim, when the community sent one. */
  roleVec?: Record<string, unknown>
  grantedAt: string
  validUntil?: string
  /** How the membership was earned — what the card says under the name. */
  via: 'invitation' | 'vetting' | 'approval' | 'unknown'
  /**
   * The admission came through a hidden-vetting proof rather than named
   * statements, so the community counted vouches without learning whose. Set
   * when the membership is filed, from the submission that earned it, because
   * nothing in the credential itself says how it was decided.
   */
  privateVetting?: boolean
  /** The directory statement the person applied under (manifest/0.4), from the submission that earned this. */
  directoryStatementDigest?: string
  /**
   * The community removed this member, as its signed removal notice says
   * (vtc/members/removal-notice/0.1, `vtiCommunityNotices`). Kept with the
   * membership, as openvtc keeps it, so the phone can say who decided, when
   * and why.
   */
  removal?: VtiRemoval
  /**
   * The member's own half of the pair: the acknowledgement this persona issued
   * back for `vmc` (vtc/members/vmc/0.1, `vtiMemberVmc`), verbatim and signed.
   * Kept before it is sent, so a re-send carries the same credential.
   */
  memberVmc?: Record<string, unknown>
  /** When the community answered that it stored `memberVmc`. Absent: not yet acknowledged. */
  memberVmcAckedAt?: string
}

/** What a community's removal notice said (vtc/members/removal-notice/0.1 payload). */
export interface VtiRemoval {
  code: 'adminRemoved' | 'purged'
  reason?: string
  decidedBy: string
  decidedAt: string
  disposition: 'purge' | 'tombstone' | 'historical'
  /** The notice's document id. */
  noticeId: string
}

/**
 * Whether a membership stands: not one the community removed (its signed
 * removal notice is kept on the record, #166). A removed membership stays in
 * the store, so the phone can say who ended it, when and why, but nothing
 * that asks "is this person a member?" counts it.
 */
export function isCurrentMembership(membership: Pick<VtiMembership, 'removal'>): boolean {
  return !membership.removal
}

/**
 * A join request this phone sent, and what the community has said about it —
 * so a screen can say "Sent — waiting for the community" until the community
 * answers, and what it answered after that (p220 item 7). Written before the
 * send, so a request whose answer was lost is still known to exist; the
 * community's status task (`join-requests/status/0.1`) fills it in later.
 */
export interface JoinSubmission {
  communityDid: string
  /** The persona the request was sent as. */
  personaDid: string
  requestId?: string
  sentAt: string
  /** When the community first answered, with a verdict or a refusal. Absent: sent, no answer yet. */
  acknowledgedAt?: string
  /** Whether an invitation went with the request. */
  withInvitation: boolean
  via: 'join' | 'vetting'
  /**
   * The request carried a hidden-vetting proof instead of statements. Kept
   * here because the membership arrives later, through the inbox, and the
   * credential does not say how the community decided.
   */
  privateVetting?: boolean
  /**
   * The `statementDigest` of the directory statement the person was shown
   * before this request (manifest/0.4), so a later statement can be told
   * apart from the one they applied under. Absent: none was shown.
   */
  directoryStatementDigest?: string
  /** The request's state as the community last stated it. */
  status?: 'pending' | 'deferred' | 'approved' | 'rejected' | 'withdrawn'
  /** What the community still needs, verbatim, while `deferred`. */
  needs?: string[]
  /** The community's refusal, while `rejected`: a stable `code`, its own words, when it decided. */
  rejection?: { code: string; reason?: string; decidedAt?: string }
  /**
   * When the person was told, once, that this request was turned down
   * (`VTI_TURNED_DOWN_EVENT`). Set with the refusal; a new request starts
   * without it.
   */
  rejectionSaidAt?: string
  /**
   * When the community, asked, said it holds no such request — the send never
   * reached it (238). Kept so a read that does not ask still says so, rather
   * than "sent" again; any later answer clears it, and a new send replaces the
   * record.
   */
  lostAt?: string
}

/** A member leaving a community from this phone. */
export interface VtiDeparture {
  communityDid: string
  /** The identity that left. Absent on departures kept before identities were told apart. */
  personaDid?: string
  /** What the community applied: `purge` erased the record, `tombstone` kept a marker. */
  disposition: 'purge' | 'tombstone' | 'historical' | (string & {})
  at: string
}

export interface VtiCommunityStore {
  listInvitations(): Promise<VtiInvitation[]>
  saveInvitation(invitation: VtiInvitation): Promise<void>
  /**
   * The membership one identity holds in a community. `personaDid` names the
   * identity; without it, the current agent's identity there (or, with none,
   * the one membership the phone has for that community that can be its own).
   */
  getMembership(communityDid: string, personaDid?: string): Promise<VtiMembership | undefined>
  /** Every identity's memberships, across agents. */
  listMemberships(): Promise<VtiMembership[]>
  saveMembership(membership: VtiMembership): Promise<void>
  /**
   * Drop what the phone holds for a community — a person starting over: the
   * membership, the invitations and the delivered credentials. With
   * `personaDid`, only that identity's; another agent's identity there keeps its own.
   */
  forgetCommunity(communityDid: string, personaDid?: string): Promise<void>
  /** Credentials a community or a vetter delivered that are not the membership itself. */
  saveHeldCredential(item: VtiHeldCredential): Promise<void>
  listHeldCredentials(kind?: VtiHeldCredential['kind'], communityDid?: string): Promise<VtiHeldCredential[]>
  /** That this phone's member left a community, and how — so its screens say "You left", not "Join". */
  getDeparture?(communityDid: string, personaDid?: string): Promise<VtiDeparture | undefined>
  saveDeparture?(departure: VtiDeparture): Promise<void>
  /** The last join request sent to a community. Optional: a store without it records none. */
  getSubmission?(communityDid: string, personaDid?: string): Promise<JoinSubmission | undefined>
  saveSubmission?(submission: JoinSubmission): Promise<void>
}

export interface VtiHeldCredential {
  kind: 'role' | 'vetter-grant' | 'vetting-statement' | 'identity-check' | 'other'
  communityDid: string
  subjectDid: string
  credential: Record<string, unknown>
  receivedAt: string
}

const RECORD_TYPE = 'keyring/vti-community'

/**
 * What names a held credential. Its own `id` when it has one; otherwise its
 * content, so the same credential delivered twice — the vetting screen and the
 * persona inbox both store what arrives — is one record, not two. Keying the
 * fallback on the arrival time counted one statement as several ("2 of 1").
 */
export function heldCredentialKey(item: Pick<VtiHeldCredential, 'kind' | 'communityDid' | 'credential'>): string {
  const id = (item.credential as { id?: unknown }).id
  if (typeof id === 'string' && id) return id
  // FNV-1a over the credential, stable across launches and cheap; a record key
  // needs to be the same for the same content, not unguessable.
  const text = JSON.stringify(item.credential)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${item.kind}:${item.communityDid}:${hash.toString(16)}`
}

/** The key of a record kept for one identity in one community. */
const identityKey = (personaDid: string, communityDid: string) => `${personaDid}|${communityDid}`

/**
 * One record per identity and community. A write interrupted between storing
 * the identity-keyed record and removing the one kept by community alone
 * leaves both; they are the same identity's, either serves, and the next
 * write removes the old one.
 */
function onePerIdentity<T extends { communityDid: string; personaDid?: string }>(records: T[]): T[] {
  const byIdentity = new Map<string, T>()
  for (const r of records) byIdentity.set(r.personaDid ? identityKey(r.personaDid, r.communityDid) : r.communityDid, r)
  return [...byIdentity.values()]
}

/**
 * Of `records`, those the current agent can hold (heldByAgent). All of them with
 * no agent known, or when the identities cannot be read: a read that fails says
 * nothing about whose they are.
 */
export async function ofCurrentAgent<T>(
  agent: Agent,
  records: T[],
  identityOf: (record: T) => string | undefined
): Promise<T[]> {
  const agentDid = currentAgentDid()
  if (!agentDid) return records
  const personas = await new GenericRecordsIdentityStore(agent).listPersonas().catch(() => undefined)
  return personas ? records.filter((r) => heldByAgent(identityOf(r), personas, agentDid)) : records
}

/** Credo generic records, one per invitation or membership, tagged for lookup. */
export class GenericRecordsCommunityStore implements VtiCommunityStore {
  constructor(private readonly agent: Agent) {}

  // One record per key, whoever writes it and however many at once (keyedRecords).
  private put(kind: string, key: string, content: Record<string, unknown>): Promise<void> {
    return putKeyed(this.agent, RECORD_TYPE, kind, key, content)
  }

  private list<T>(kind: string): Promise<T[]> {
    return listKeyed<T>(this.agent, RECORD_TYPE, kind)
  }

  listInvitations() {
    return this.list<VtiInvitation>('invitation')
  }

  async saveInvitation(invitation: VtiInvitation) {
    await this.put('invitation', invitation.id, { ...invitation })
    emitCommunityChanged(invitation.communityDid, 'invitation')
  }

  async getMembership(communityDid: string, personaDid?: string) {
    return this.ofIdentity<VtiMembership>('membership', communityDid, personaDid)
  }

  async listMemberships() {
    return onePerIdentity(await this.list<VtiMembership>('membership'))
  }

  async saveMembership(membership: VtiMembership) {
    await this.putForIdentity('membership', membership)
    emitCommunityChanged(membership.communityDid, 'membership')
  }

  /**
   * Memberships, join requests and departures are kept per identity — its
   * DID and the community — so two agents' identities in one community each
   * keep their own: one record per community let a second agent's join
   * overwrite the first's membership (several-agents device check, 10-04).
   * Records kept by community alone, before, are still read, and move under
   * their identity at the next write.
   */
  private async ofIdentity<T extends { communityDid: string; personaDid?: string }>(
    kind: string,
    communityDid: string,
    personaDid?: string,
    ownOnly = true
  ): Promise<T | undefined> {
    const here = onePerIdentity((await this.list<T>(kind)).filter((r) => r.communityDid === communityDid))
    if (here.length === 0) return undefined
    if (personaDid) return here.find((r) => r.personaDid === personaDid)
    const mine = await new GenericRecordsIdentityStore(this.agent).getPersona(communityDid).catch(() => undefined)
    if (mine) return here.find((r) => r.personaDid === mine.did) ?? here.find((r) => !r.personaDid)
    // No identity of the current agent's here: what the phone has, if it can be this agent's.
    const held = ownOnly ? await ofCurrentAgent(this.agent, here, (r) => r.personaDid) : here
    return held.length === 1 ? held[0] : undefined
  }

  private async putForIdentity(kind: string, record: { communityDid: string; personaDid?: string }) {
    if (!record.personaDid) {
      await this.put(kind, record.communityDid, { ...record })
      return
    }
    await this.put(kind, identityKey(record.personaDid, record.communityDid), { ...record })
    // The same identity's record kept by community alone is now kept under it.
    const kept = await this.agent.genericRecords.findAllByQuery({
      recordType: RECORD_TYPE,
      kind,
      key: record.communityDid,
    })
    for (const r of kept) {
      const owner = (r.content as { personaDid?: string }).personaDid
      if (!owner || owner === record.personaDid) await this.agent.genericRecords.delete(r)
    }
  }

  /**
   * What a community calls itself, as its manifest last said. Kept so a
   * relaunch still names it: the name otherwise lived only in memory, and
   * every community read as unnamed until a join or vetting screen happened
   * to read its manifest again (IN-26).
   *
   * `at` is when the community last said it, unchanged or not: a sign-in reads
   * the name again once it is older than a day (signInSteps, IN-340), and a
   * name confirmed today must not read as a day old.
   */
  async saveCommunityName(communityDid: string, name?: string) {
    const named = name?.trim()
    if (!communityDid || !named) return
    await this.put('community-name', communityDid, { communityDid, name: named, at: new Date().toISOString() })
  }

  listCommunityNames() {
    return this.list<{ communityDid: string; name: string; at?: string }>('community-name')
  }

  /**
   * How a community dresses its cards, as it last said: its accent colour and a logo address, each kept only when it
   * is usable (a #rrggbb colour; an https address). A read that found neither is kept too, so the Wallet knows the
   * community has none rather than that it was never asked (communityBrand.ts).
   */
  async saveCommunityBrand(communityDid: string, brand: { accentColor?: unknown; logoUrl?: unknown }) {
    if (!communityDid) return
    await this.put('community-brand', communityDid, {
      communityDid,
      accentColor: normalisedAccent(brand.accentColor),
      logoUrl: httpsLogoUrl(brand.logoUrl),
      at: new Date().toISOString(),
    })
    emitCommunityBrandSaved(communityDid)
  }

  listCommunityBrands() {
    return this.list<CommunityBrandRecord>('community-brand')
  }

  async forgetCommunity(communityDid: string, personaDid?: string) {
    const ofIdentity = (owner: string | undefined) => !personaDid || !owner || owner === personaDid
    const memberships = (
      await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'membership' })
    ).filter((r) => {
      const m = r.content as unknown as VtiMembership
      return m.communityDid === communityDid && ofIdentity(m.personaDid)
    })
    const invitations = (await this.listInvitationRecords()).filter((r) => {
      const i = r.content as unknown as VtiInvitation
      return i.communityDid === communityDid && ofIdentity(i.subjectDid)
    })
    const held = (
      await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'credential' })
    ).filter((r) => {
      const c = r.content as unknown as VtiHeldCredential
      return c.communityDid === communityDid && ofIdentity(c.subjectDid)
    })
    for (const record of [...memberships, ...invitations, ...held]) await this.agent.genericRecords.delete(record)
    emitCommunityChanged(communityDid, 'forgotten')
  }

  private listInvitationRecords() {
    return this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'invitation' })
  }

  async getSubmission(communityDid: string, personaDid?: string) {
    return this.ofIdentity<JoinSubmission>('submission', communityDid, personaDid)
  }

  async getDeparture(communityDid: string, personaDid?: string) {
    // Leaving forgets the identity, so nothing can tie a departure to its agent. It reads as before: it says
    // "You left", which offers joining again, and never stops anyone applying.
    return this.ofIdentity<VtiDeparture>('departure', communityDid, personaDid, false)
  }

  async saveDeparture(departure: VtiDeparture) {
    await this.putForIdentity('departure', departure)
    emitCommunityChanged(departure.communityDid, 'departure')
  }

  async saveSubmission(submission: JoinSubmission) {
    await this.putForIdentity('submission', submission)
    emitCommunityChanged(submission.communityDid, 'submission')
  }

  async saveHeldCredential(item: VtiHeldCredential) {
    await this.put('credential', heldCredentialKey(item), { ...item })
    emitCommunityChanged(item.communityDid, changeOfHeldCredential(item.kind))
  }

  async listHeldCredentials(kind?: VtiHeldCredential['kind'], communityDid?: string) {
    const all = await this.list<VtiHeldCredential>('credential')
    const wanted = all.filter((c) => (!kind || c.kind === kind) && (!communityDid || c.communityDid === communityDid))
    // One credential, once — however many times it arrived. Records written
    // before the key was content-addressed can hold the same credential twice.
    const byIdentity = new Map<string, VtiHeldCredential>()
    for (const c of wanted) {
      const key = heldCredentialKey(c)
      const seen = byIdentity.get(key)
      if (!seen || c.receivedAt < seen.receivedAt) byIdentity.set(key, c)
    }
    return [...byIdentity.values()]
  }
}
