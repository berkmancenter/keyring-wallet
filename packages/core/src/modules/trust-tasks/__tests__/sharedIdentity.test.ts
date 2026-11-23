/**
 * One identity in two communities (IN-517). A tester joined Test VTC, elsewhere, with the identity his phone keeps
 * for First VTC. Test VTC's cards reached the phone addressed to that identity and were filed under it, and the
 * phone kept no identity for Test VTC: Leave failed ("this phone holds no identity for that community"), and the
 * directory said Test VTC "didn't answer" though nothing was ever asked of it.
 *
 * These run the real write order: a community's delivery through the persona inbox (keepForPersona → receiveIssue)
 * into the real identity and community stores, then the readers and Leave over what was written.
 */
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { directoryStatusOf } from '../../directory/directoryService'
import { directoryRetryable } from '../../directory/components/directoryWords'
import { setCurrentAgentDid } from '../module/currentAgent'
import {
  canSignAs,
  HEAL_AGAIN_MS,
  healSharedIdentities,
  personaForCommunity,
  shareIdentityWith,
  VtiKeysNotHeld,
  VtiNoIdentity,
} from '../module/sharedIdentity'
import { vtiAgent } from '../module/vtiAgent'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
import { leaveCommunity } from '../module/vtiJoin'
import { REMOVAL_NOTICE } from '../module/vtiCommunityNotices'
import { keepForPersona } from '../module/vtiPersonaInbox'
import { GenericRecordsVettingStore } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// A removal notice's proof is vtiCommunityNotices' own tests; here it is taken as a removal.
const mockReceiveNotice = jest.fn(async (..._a: unknown[]) => 'removed')
jest.mock('../module/vtiCommunityNotices', () => ({
  ...jest.requireActual('../module/vtiCommunityNotices'),
  receiveCommunityNotice: (...a: unknown[]) => mockReceiveNotice(...a),
}))
// The change events are deferred on a timer; nothing here listens for them.
jest.mock('../module/communityChanged', () => ({
  ...jest.requireActual('../module/communityChanged'),
  emitCommunityChanged: jest.fn(),
}))
// The card's proof and status list are vtiDeliveredCheck's own tests; here every card holds up.
jest.mock('../module/vtiDeliveredCheck', () => ({
  ...jest.requireActual('../module/vtiDeliveredCheck'),
  deliveredCardCheck: () => async () => undefined,
}))
const mockReciprocate = jest.fn(async (..._a: unknown[]) => 'sent')
jest.mock('../module/vtiReciprocate', () => ({
  ...jest.requireActual('../module/vtiReciprocate'),
  reciprocateIfOwed: (...a: unknown[]) => mockReciprocate(...a),
}))

const AGENT = 'did:webvh:QmAgent:dids.example:gt-vta'
/** The community the identity was made for (First VTC in the report). */
const FIRST = 'did:webvh:QmFirst:vtc.example:first-vtc'
/** The community that admitted the same identity elsewhere (Test VTC). */
const TEST = 'did:webvh:QmTest:vtc.example:test-vtc'
const ID = 'did:webvh:QmIdentity:dids.example:airport-electric'
const OTHER_ID = 'did:webvh:QmOther:dids.example:another-identity'

const persona = (did: string, communityDid: string, extra: Partial<VtiPersona> = {}): VtiPersona => ({
  communityDid,
  vtaDid: AGENT,
  did,
  contextId: 'ctx',
  vtaKeyIds: { signing: `${did}#key-0`, keyAgreement: `${did}#key-1` },
  kmsKeyIds: { signing: `vta-copy:${AGENT}:${did}#key-0`, keyAgreement: `vta-copy:${AGENT}:${did}#key-1` },
  createdAt: '2026-10-06T00:00:00Z',
  ...extra,
})

const card = (community: string, subject: string, id = `urn:uuid:${community.slice(-8)}-vmc`) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id,
  type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
  issuer: community,
  issuerScope: 'public',
  validFrom: '2026-10-19T00:00:00Z',
  validUntil: '2026-11-18T00:00:00Z',
  credentialSubject: { id: subject },
})

const issue = (community: string, vc: Record<string, unknown>) =>
  ({
    id: `msg-${String(vc.id)}`,
    type: CREDENTIAL_EXCHANGE_ISSUE,
    from: community,
    body: { payload: { credential_response: { credential: vc } } },
  }) as unknown as DidCommV2PlaintextMessage

async function setup() {
  const { agent } = fakeAgent()
  setCurrentAgentDid(AGENT)
  const identities = new GenericRecordsIdentityStore(agent)
  const communities = new GenericRecordsCommunityStore(agent)
  const first = persona(ID, FIRST)
  await identities.setPersona(first)
  const firstMembership: VtiMembership = {
    communityDid: FIRST,
    personaDid: ID,
    role: 'member',
    vmc: card(FIRST, ID, 'urn:uuid:first-vmc'),
    grantedAt: '2026-10-06T00:00:00Z',
    via: 'approval',
  }
  await communities.saveMembership(firstMembership)
  return { agent, identities, communities, first, firstMembership }
}

afterEach(() => {
  setCurrentAgentDid(undefined)
  mockReciprocate.mockClear()
  jest.restoreAllMocks()
})

describe('a card from a community the identity was not made for', () => {
  it('keeps the identity for that community too, files the membership under it, and leaves the first as it was', async () => {
    const { agent, identities, communities, first } = await setup()
    await keepForPersona(agent, first, issue(TEST, card(TEST, ID)))

    const kept = await identities.getPersona(TEST)
    expect(kept).toMatchObject({ communityDid: TEST, did: ID, vtaDid: AGENT, vtaKeyIds: first.vtaKeyIds })
    expect(kept?.kmsKeyIds).toEqual(first.kmsKeyIds)
    expect(await communities.getMembership(TEST)).toMatchObject({ communityDid: TEST, personaDid: ID })
    // The first community's identity and membership are untouched.
    expect(await identities.getPersona(FIRST)).toEqual(first)
    expect(await communities.getMembership(FIRST)).toMatchObject({ communityDid: FIRST, personaDid: ID })
    // The acknowledgement goes to the community that sent the card, not the one the identity was made for.
    expect(mockReciprocate).toHaveBeenCalledTimes(1)
    expect(mockReciprocate.mock.calls[0][3]).toBe(TEST)
  })

  it('a card for the same community again keeps exactly one record for it', async () => {
    const { agent, identities, first } = await setup()
    await keepForPersona(agent, first, issue(TEST, card(TEST, ID)))
    await keepForPersona(agent, first, issue(TEST, card(TEST, ID, 'urn:uuid:test-vmc-renewed')))
    const forTest = (await identities.listPersonas()).filter((p) => p.communityDid === TEST)
    expect(forTest).toHaveLength(1)
  })

  it('never over another identity the phone keeps for that community: the card is kept on its own', async () => {
    const { agent, identities, communities, first } = await setup()
    await identities.setPersona(persona(OTHER_ID, TEST))
    await keepForPersona(agent, first, issue(TEST, card(TEST, ID)))

    expect((await identities.getPersona(TEST))?.did).toBe(OTHER_ID)
    expect(await communities.getMembership(TEST, ID)).toBeUndefined()
    const held = await communities.listHeldCredentials('other', TEST)
    expect(held.map((h) => h.credential.id)).toEqual(['urn:uuid:test-vtc-vmc'])
    expect(mockReciprocate).not.toHaveBeenCalled()
  })

  it("never for the agent's own DID", async () => {
    const { identities } = await setup()
    const own = persona(AGENT, FIRST)
    await expect(shareIdentityWith(identities, own, TEST)).resolves.toBe('agentItself')
    expect(await identities.getPersona(TEST)).toBeUndefined()
  })
})

// ac on #938: an install from before memory-only custody keeps an identity's copies in the wallet's store until its
// keys move (vtaKeyMigration). Those belong to the first record, and a record naming one copy of two cannot sign.
describe('an identity whose key copies are not both in memory', () => {
  it('kept for the second community names no copies at all, and cannot sign until the agent hands them over', async () => {
    const { agent, identities, first } = await setup()
    const stored = { ...first, kmsKeyIds: { signing: 'kms-signing', keyAgreement: 'kms-ka' } }
    await identities.setPersona(stored)
    await keepForPersona(agent, stored, issue(TEST, card(TEST, ID)))
    const kept = await identities.getPersona(TEST)
    expect(kept?.did).toBe(ID)
    expect(kept?.kmsKeyIds).toBeUndefined()
    expect(canSignAs(kept)).toBe(false)
    // The first record keeps its own copies.
    expect((await identities.getPersona(FIRST))?.kmsKeyIds).toEqual(stored.kmsKeyIds)
  })

  it('one copy in memory and one stored: still none named, never half', async () => {
    const { agent, identities, first } = await setup()
    const half = { ...first, kmsKeyIds: { signing: 'kms-signing', keyAgreement: first.kmsKeyIds?.keyAgreement } }
    await identities.setPersona(half)
    await keepForPersona(agent, half, issue(TEST, card(TEST, ID)))
    expect((await identities.getPersona(TEST))?.kmsKeyIds).toBeUndefined()
  })

  it('both in memory: named, and it can sign (control)', async () => {
    const { agent, identities, first } = await setup()
    await keepForPersona(agent, first, issue(TEST, card(TEST, ID)))
    expect(canSignAs(await identities.getPersona(TEST))).toBe(true)
  })

  it('Leave of the second community refuses before anything is sent or cleared', async () => {
    const { agent, identities, communities, first } = await setup()
    const stored = { ...first, kmsKeyIds: { signing: 'kms-signing', keyAgreement: 'kms-ka' } }
    await identities.setPersona(stored)
    await keepForPersona(agent, stored, issue(TEST, card(TEST, ID)))
    const connect = jest.spyOn(vtiAgent, 'connect')
    const remove = jest.spyOn(vtiAgent, 'selfRemove')
    await expect(
      leaveCommunity({ agent, identityStore: identities, communityStore: communities }, TEST)
    ).rejects.toBeInstanceOf(VtiKeysNotHeld)
    expect(connect).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await identities.getPersona(TEST)).toBeDefined()
    expect(await communities.getMembership(TEST, ID)).toBeDefined()
  })
})

describe('a reader that finds no identity', () => {
  it('heals once per store within a while, not on every read; again after it', async () => {
    const { identities, communities } = await setup()
    const scan = jest.spyOn(communities, 'listMemberships')
    let at = 1_000_000
    const now = () => at
    await expect(personaForCommunity(identities, communities, TEST, now)).resolves.toBeUndefined()
    await expect(personaForCommunity(identities, communities, TEST, now)).resolves.toBeUndefined()
    expect(scan).toHaveBeenCalledTimes(1)
    at += HEAL_AGAIN_MS
    await personaForCommunity(identities, communities, TEST, now)
    expect(scan).toHaveBeenCalledTimes(2)
  })
})

describe("a community's removal notice, to an identity kept for two communities", () => {
  const notice = (from: string) => ({ type: REMOVAL_NOTICE, from, body: {} }) as unknown as DidCommV2PlaintextMessage

  it('ends the application of the community that sent it, not the one the identity was made for', async () => {
    const { agent, first } = await setup()
    const forget = jest.spyOn(GenericRecordsVettingStore.prototype, 'forgetApplication').mockResolvedValue(undefined)
    await keepForPersona(agent, first, notice(TEST))
    expect(forget.mock.calls).toEqual([[TEST]])
  })

  it("from the identity's own community, ends that one's (control)", async () => {
    const { agent, first } = await setup()
    const forget = jest.spyOn(GenericRecordsVettingStore.prototype, 'forgetApplication').mockResolvedValue(undefined)
    await keepForPersona(agent, first, notice(FIRST))
    expect(forget.mock.calls).toEqual([[FIRST]])
  })
})

describe('a phone that filed such a card before this change', () => {
  // The state the old write order left: the card filed under the first community's identity, nothing kept for the
  // second. The join path still files this way (no fileUnder), so it is produced here by the code that produced it.
  const oldState = async () => {
    const s = await setup()
    await receiveIssue(s.communities, ID, issue(TEST, card(TEST, ID)), { checkCard: async () => undefined })
    expect(await s.identities.getPersona(TEST)).toBeUndefined()
    expect(await s.communities.getMembership(TEST, ID)).toBeDefined()
    return s
  }

  it('heals in place: the identity is kept for the second community once, and the first is untouched', async () => {
    const { identities, communities, first } = await oldState()
    await expect(healSharedIdentities(identities, communities)).resolves.toBe(1)
    await expect(healSharedIdentities(identities, communities)).resolves.toBe(0)
    expect((await identities.getPersona(TEST))?.did).toBe(ID)
    expect((await identities.listPersonas()).filter((p) => p.communityDid === TEST)).toHaveLength(1)
    expect(await identities.getPersona(FIRST)).toEqual(first)
  })

  it('a reader asking for the second community finds the identity, healing as it asks', async () => {
    const { identities, communities } = await oldState()
    await expect(personaForCommunity(identities, communities, TEST)).resolves.toMatchObject({ did: ID })
  })

  it('leaves the second community as that identity, and forgets only what was kept for it', async () => {
    const { agent, identities, communities, first } = await oldState()
    const connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
    const remove = jest.spyOn(vtiAgent, 'selfRemove').mockResolvedValue({ disposition: 'purge', removed: true })
    const vettingStore = { forget: jest.fn(async () => undefined) }

    await expect(
      leaveCommunity({ agent, identityStore: identities, communityStore: communities, vettingStore }, TEST)
    ).resolves.toEqual({ disposition: 'purge', alreadyGone: false })

    expect((connect.mock.calls[0][2] as { persona: VtiPersona }).persona).toMatchObject({ did: ID, communityDid: TEST })
    expect(remove).toHaveBeenCalledWith(TEST, expect.anything())
    expect(vettingStore.forget).toHaveBeenCalledWith(TEST)
    expect(await identities.getPersona(TEST)).toBeUndefined()
    expect(await communities.getMembership(TEST, ID)).toBeUndefined()
    // First VTC still has its identity and its membership.
    expect(await identities.getPersona(FIRST)).toEqual(first)
    expect(await communities.getMembership(FIRST)).toMatchObject({ personaDid: ID })
  })
})

describe('a membership with no identity the phone can sign in as', () => {
  it('Leave refuses by name and clears nothing', async () => {
    const { agent, identities, communities } = await setup()
    // A membership naming the agent itself (#851): no identity of the phone's, never one made for it.
    await communities.saveMembership({
      communityDid: TEST,
      personaDid: AGENT,
      role: 'member',
      vmc: card(TEST, AGENT),
      grantedAt: '2026-10-19T00:00:00Z',
      via: 'unknown',
    })
    const remove = jest.spyOn(vtiAgent, 'selfRemove')
    await expect(
      leaveCommunity({ agent, identityStore: identities, communityStore: communities }, TEST)
    ).rejects.toBeInstanceOf(VtiNoIdentity)
    expect(remove).not.toHaveBeenCalled()
    expect(await communities.getMembership(TEST, AGENT)).toBeDefined()
    expect(await identities.getPersona(TEST)).toBeUndefined()
  })

  it('the directory says the phone has no identity there, not that the community did not answer, with no Try again', () => {
    const status = directoryStatusOf(new VtiNoIdentity())
    expect(status.reason).toBe('noIdentity')
    expect(directoryRetryable(status)).toBe(false)
    // Control: anything else is still a community that did not answer, which Try again can help.
    // Keys not on the phone yet: its own words, and Try again helps once the agent has connected.
    const keys = directoryStatusOf(new VtiKeysNotHeld())
    expect(keys.reason).toBe('keysNotHeld')
    expect(directoryRetryable(keys)).toBe(true)
    const other = directoryStatusOf(new Error('socket closed'))
    expect(other.reason).toBe('communityUnreachable')
    expect(directoryRetryable(other)).toBe(true)
  })
})
