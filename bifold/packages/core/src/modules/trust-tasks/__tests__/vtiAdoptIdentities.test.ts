/**
 * A phone takes on its agent's community identities when the person asks
 * (242): a new install, or an identity made with pnm/openvtc on the same agent
 * (IN-363, IN-114). The agent's DIDs and the cards its vault keeps about them
 * say which identity is whose; the identity's DID document says its key ids.
 */
import {
  COMMUNITY,
  fakeVault,
  membershipCard,
  persona,
  PERSONA_DID,
  roleCard,
  roleVac,
} from '../../../../__tests__/helpers/cardVault'
import type { VtaMintedDid } from '../module/VtaClient'
import { fetchAgentCards } from '../module/vtiCardVault'
import {
  adoptAgentIdentities,
  keyIdsFromDocument,
  visibleContextsOf,
  type AdoptionKeyIds,
} from '../module/vtiAdoptIdentities'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const VTA = persona.vtaDid
const OTHER_COMMUNITY = 'did:webvh:QmOther:vtc.example:second-vtc'
const NOW = Date.parse('2026-10-13T12:00:00Z')

// What `dids/list` answers: the agent's DID record (vta-sdk `WebvhDidRecord`), which carries no key ids.
const listed = (did: string, contextId: string) =>
  ({ did, contextId, scid: 'Qm', serverId: 'serverless' }) as unknown as VtaMintedDid
const ofPersona = listed(PERSONA_DID, 'keyring')
// The key ids the agent keeps an identity's keys under: its published document's verification methods.
const keysOf = (did: string): AdoptionKeyIds => ({ signing: `${did}#key-0`, keyAgreement: `${did}#key-1` })

function identities(held: VtiPersona[] = []) {
  const map = new Map(held.map((p) => [`${p.vtaDid}|${p.communityDid}`, p]))
  const store = {
    getPersona: async (communityDid: string, vtaDid?: string) => map.get(`${vtaDid}|${communityDid}`),
    setPersona: jest.fn(async (p: VtiPersona) => void map.set(`${p.vtaDid}|${p.communityDid}`, p)),
  }
  return { store: store as unknown as VtiIdentityStore & { setPersona: jest.Mock }, map }
}

async function vaultWith(...cards: Record<string, unknown>[]) {
  const vault = fakeVault()
  for (const credential of cards) {
    await vault.task('https://trusttasks.org/spec/vault/credentials/receive/0.1', { credential })
  }
  return vault
}

const holdsUp = async () => undefined

const adopt = async (
  store: VtiIdentityStore,
  task: ReturnType<typeof fakeVault>['task'],
  dids: VtaMintedDid[] = [ofPersona],
  held: string[] = [],
  keyIdsOf: (did: string) => Promise<AdoptionKeyIds | undefined> = async (did) => keysOf(did),
  check: (credential: Record<string, unknown>, issuer: string) => Promise<string | undefined> = holdsUp
) =>
  adoptAgentIdentities({
    identities: store,
    vtaDid: VTA,
    cards: await fetchAgentCards(task),
    check,
    listDids: async () => dids,
    keyIdsOf,
    held,
    now: () => NOW,
  })

describe("taking on the agent's identities", () => {
  it("a membership card about one of the agent's DIDs: that identity, for that community, with its document's key ids", async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard)
    const { adopted } = await adopt(store, vault.task)
    expect(adopted).toEqual([
      {
        communityDid: COMMUNITY,
        vtaDid: VTA,
        did: PERSONA_DID,
        contextId: 'keyring',
        vtaKeyIds: { signing: `${PERSONA_DID}#key-0`, keyAgreement: `${PERSONA_DID}#key-1` },
        createdAt: new Date(NOW).toISOString(),
      },
    ])
    expect(store.setPersona).toHaveBeenCalledTimes(1)
  })

  // IN-363 / IN-114 (Geoff): a persona made with pnm in a nested context on a second agent, a membership and a role
  // in a community there, on a phone that already holds identities of its own. The agent's DID list carries no key
  // ids, so they are the document's, and the context is the nested one the persona was made in.
  it('an identity pnm made in a nested context, on a phone that holds others: taken on, the others untouched', async () => {
    const PNM_DID = 'did:webvh:QmAlice:dids.example:openvtc-alice'
    const pnmMembership = {
      ...membershipCard,
      id: 'urn:uuid:66666666-6666-4666-8666-666666666666',
      issuer: OTHER_COMMUNITY,
      credentialSubject: { id: PNM_DID },
    }
    const pnmRole = {
      ...roleCard,
      id: 'urn:uuid:77777777-7777-4777-8777-777777777777',
      issuer: OTHER_COMMUNITY,
      credentialSubject: {
        id: PNM_DID,
        endorsement: { type: 'CommunityRole', role: 'member', communityDid: OTHER_COMMUNITY },
      },
    }
    const ownElsewhere: VtiPersona = { ...persona, communityDid: 'did:webvh:QmThird:vtc.example:third-vtc' }
    const { store, map } = identities([persona, ownElsewhere])
    const vault = await vaultWith(membershipCard, pnmMembership, pnmRole)
    const report = await adopt(
      store,
      vault.task,
      [ofPersona, listed(PNM_DID, 'openvtc-alice/alice')],
      [PERSONA_DID],
      async (did) => keyIdsFromDocument(did, { assertionMethod: ['#key-0'], keyAgreement: [{ id: `${did}#key-1` }] })
    )

    expect(report.adopted).toEqual([
      {
        communityDid: OTHER_COMMUNITY,
        vtaDid: VTA,
        did: PNM_DID,
        contextId: 'openvtc-alice/alice',
        vtaKeyIds: { signing: `${PNM_DID}#key-0`, keyAgreement: `${PNM_DID}#key-1` },
        createdAt: new Date(NOW).toISOString(),
      },
    ])
    expect(report).toMatchObject({ otherIdentities: 1, cardsForOthers: 2, unreadable: [] })
    // The identities this phone made itself are as they were.
    expect(map.get(`${VTA}|${COMMUNITY}`)).toBe(persona)
    expect(map.get(`${VTA}|${ownElsewhere.communityDid}`)).toBe(ownElsewhere)
  })

  it('an identity whose DID document cannot be read is skipped and reported, never guessed at', async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard)
    const report = await adopt(store, vault.task, [ofPersona], [], async () => undefined)
    expect(report.adopted).toEqual([])
    expect(report.unreadable).toEqual([PERSONA_DID])
    expect(store.setPersona).not.toHaveBeenCalled()
  })

  it('a community known only by a DTG v1 role grant (an AuthorityCredential, here role:vetter) is taken on too', async () => {
    const { store } = identities()
    const vault = await vaultWith(roleVac)
    expect((await adopt(store, vault.task)).adopted.map((p) => p.communityDid)).toEqual([COMMUNITY])
  })

  it('a membership card and a role card for one community make one identity', async () => {
    const { store } = identities()
    const vault = await vaultWith(roleCard, membershipCard)
    expect((await adopt(store, vault.task)).adopted).toHaveLength(1)
  })

  it("a card about a DID that is not the agent's is left alone", async () => {
    const { store } = identities()
    const stranger = {
      ...membershipCard,
      id: 'urn:uuid:55555555-5555-4555-8555-555555555555',
      issuer: OTHER_COMMUNITY,
      credentialSubject: { id: 'did:webvh:QmSomeoneElse:dids.example:x' },
    }
    const vault = await vaultWith(stranger)
    expect((await adopt(store, vault.task)).adopted).toEqual([])
    expect(store.setPersona).not.toHaveBeenCalled()
  })

  it('an identity this phone already holds for the community is kept as it is', async () => {
    const { store, map } = identities([persona])
    const vault = await vaultWith(membershipCard)
    expect((await adopt(store, vault.task, [ofPersona], [PERSONA_DID])).adopted).toEqual([])
    expect(map.get(`${VTA}|${COMMUNITY}`)).toBe(persona)
  })

  it('an agent with no DIDs takes nothing on', async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard)
    expect(await adopt(store, vault.task, [])).toMatchObject({ adopted: [], otherIdentities: 0 })
    expect(store.setPersona).not.toHaveBeenCalled()
  })

  // #401 Farm run: an identity was taken on from a lab community's card the wallet then refused to keep.
  it('a card that does not hold up takes no identity on, and is reported', async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard)
    const report = await adopt(store, vault.task, [ofPersona], [], undefined, async () => 'revoked')
    expect(report.adopted).toEqual([])
    expect(report.failedCheck).toEqual([{ credentialId: membershipCard.id, communityDid: COMMUNITY }])
    expect(store.setPersona).not.toHaveBeenCalled()
  })

  it('a membership card that does not hold up gives way to a role card that does', async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard, roleCard)
    const check = async (credential: Record<string, unknown>) =>
      credential.id === membershipCard.id ? 'revoked' : undefined
    const report = await adopt(store, vault.task, [ofPersona], [], undefined, check)
    expect(report.adopted.map((p) => p.communityDid)).toEqual([COMMUNITY])
    expect(report.failedCheck.map((f) => f.credentialId)).toEqual([membershipCard.id])
  })

  it('an agent that does not answer throws, and nothing is recorded', async () => {
    const { store } = identities()
    await expect(
      adoptAgentIdentities({
        identities: store,
        vtaDid: VTA,
        cards: [],
        check: holdsUp,
        listDids: async () => {
          throw new Error('the VTA did not answer')
        },
        keyIdsOf: async (did) => keysOf(did),
      })
    ).rejects.toThrow('did not answer')
    expect(store.setPersona).not.toHaveBeenCalled()
  })
})

// Why nothing came back, from the counts: what the screen turns into words.
describe('what a run found', () => {
  it('no identity but the ones this phone holds: no other identity', async () => {
    const { store } = identities([persona])
    const vault = await vaultWith(membershipCard)
    expect(await adopt(store, vault.task, [ofPersona], [PERSONA_DID])).toMatchObject({ otherIdentities: 0 })
  })

  it('another identity, but no community card about it: no cards for others', async () => {
    const { store } = identities([persona])
    const vault = await vaultWith(membershipCard)
    const report = await adopt(
      store,
      vault.task,
      [ofPersona, listed('did:webvh:QmBare:dids.example:no-cards', 'openvtc-alice/alice')],
      [PERSONA_DID]
    )
    expect(report).toMatchObject({ adopted: [], otherIdentities: 1, cardsForOthers: 0 })
  })
})

describe("an identity's key ids, from its DID document", () => {
  const DID = 'did:webvh:QmX:dids.example:x'
  it('the first assertion method signs, the first keyAgreement entry agrees; a relative id is the DID’s', () => {
    expect(keyIdsFromDocument(DID, { assertionMethod: ['#key-0'], keyAgreement: [{ id: `${DID}#key-1` }] })).toEqual({
      signing: `${DID}#key-0`,
      keyAgreement: `${DID}#key-1`,
    })
  })
  it('authentication signs when no assertion method is named', () => {
    expect(keyIdsFromDocument(DID, { authentication: [{ id: '#sig' }], keyAgreement: ['#ka'] })).toEqual({
      signing: `${DID}#sig`,
      keyAgreement: `${DID}#ka`,
    })
  })
  it('a document without a key-agreement key, or none at all, gives nothing', () => {
    expect(keyIdsFromDocument(DID, { assertionMethod: ['#key-0'] })).toBeUndefined()
    expect(keyIdsFromDocument(DID, undefined)).toBeUndefined()
  })
})

describe('the contexts a grant lets this phone see', () => {
  it('a scoped grant names its contexts; an unrestricted one (no scopes) names none', () => {
    expect(visibleContextsOf(['ctx:keyring', 'ctx:openvtc-alice'])).toEqual(['keyring', 'openvtc-alice'])
    expect(visibleContextsOf([])).toBeUndefined()
    expect(visibleContextsOf(undefined)).toBeUndefined()
  })
})
