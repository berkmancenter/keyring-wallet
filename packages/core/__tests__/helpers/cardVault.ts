/**
 * Fixtures for agent-kept cards (vtiCardVault), shared by the module's tests
 * and the screens' (Wallet cards, "Kept by your agent", "Get your cards from
 * your agent"): a persona, its community, one card per vault state, an agent
 * whose generic records live in memory, a community store, and a vault that
 * answers as a VTA does.
 */
import type {
  VtiCommunityStore,
  VtiHeldCredential,
  VtiMembership,
} from '../../src/modules/trust-tasks/module/VtiCommunityStore'
import type { VtiPersona } from '../../src/modules/trust-tasks/module/VtiIdentityStore'
import { seedCardVaultStateForTests, type CardVaultState } from '../../src/modules/trust-tasks/module/vtiCardVault'

/**
 * Put a card in a vault state for a screen test, without the keep or recover
 * paths: the state is read at once through `cardVaultStateOf`, and subscribers
 * hear it. Call `resetCardVaultCache` between tests.
 */
export function seedCardVaultState(credentialId: string, state: CardVaultState): void {
  seedCardVaultStateForTests(credentialId, state)
}

export const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
export const PERSONA_DID = 'did:webvh:QmPersona:dids.example:negative-weird'

export const persona: VtiPersona = {
  communityDid: COMMUNITY,
  vtaDid: 'did:webvh:QmVta:dids.example:keyring-al-vta',
  did: PERSONA_DID,
  contextId: 'ctx-negative-weird',
  vtaKeyIds: { signing: `${PERSONA_DID}#key-0`, keyAgreement: `${PERSONA_DID}#key-1` },
  kmsKeyIds: { signing: 'kms-signing', keyAgreement: 'kms-ka' },
  createdAt: '2026-09-25T21:30:00Z',
}

const base = (id: string, type: string, subject: Record<string, unknown>, proof: unknown) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
  id,
  type: ['VerifiableCredential', 'DTGCredential', type],
  issuer: COMMUNITY,
  validFrom: '2026-09-26T09:00:00Z',
  validUntil: '2026-10-26T09:00:00Z',
  credentialSubject: { id: PERSONA_DID, ...subject },
  proof,
})
/** Proofs as a VTC signs them (vtc-service credentials/signer.rs): what the Wallet's JSON-LD reader accepts. */
const oneProof = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  proofPurpose: 'assertionMethod',
  verificationMethod: `${COMMUNITY}#key-0`,
  created: '2026-09-26T09:00:00Z',
  proofValue: 'z3FXQqFwbZxKBxGxqFpCDabcM5gTnBqXxqZ4nY8qGvLmM9Q4aXcR2p7nDtWsVbJ6kHfEoYuLiTzRyNmPqWxCvBnA',
}
const proofSet = [
  oneProof,
  {
    type: 'DataIntegrityProof',
    cryptosuite: 'mldsa44-jcs-2024',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${COMMUNITY}#key-pq`,
    created: '2026-09-26T09:00:00Z',
    proofValue: 'z2PqMldsaSignaturePlaceholderForTheFixtureOnly',
  },
]

/** A community's membership card: the agent can keep it. */
export const membershipCard = base(
  'urn:uuid:11111111-1111-4111-8111-111111111111',
  'MembershipCredential',
  {},
  oneProof
)
/** A role card (`CommunityRole`, member). */
export const roleCard = base(
  'urn:uuid:22222222-2222-4222-8222-222222222222',
  'EndorsementCredential',
  { endorsement: { type: 'CommunityRole', role: 'member', communityDid: COMMUNITY } },
  oneProof
)
/**
 * A role grant in DTG Credentials v1's shape, an `AuthorityCredential` (VTI
 * #1859 on). Its type names none of the vault's purposes, so the vault files
 * it with no purpose (vta-vault receive.rs `infer_purpose`).
 */
export const roleVac = base(
  'urn:uuid:44444444-4444-4444-8444-444444444444',
  'AuthorityCredential',
  { authority: { scope: COMMUNITY, actions: ['role:vetter'], maxAttenuation: 0 } },
  oneProof
)
/** A vetter grant from a community that signs with two keys: the vault refuses its proof set (VTI-44 (e)). */
export const vetterGrantProofSet = base(
  'urn:uuid:33333333-3333-4333-8333-333333333333',
  'EndorsementCredential',
  { endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: COMMUNITY } },
  proofSet
)

/** A data room the persona was admitted to, hosted by the community (vtc-service `room-dids`). */
export const ROOM = 'did:webvh:QmRoom:vtc.example:room-dids:c56d36fc3bbe4fc9a3270b594d4d2c78'
/** A room's card, in the shape the room issues it: its own DID as issuer, DTG v1's context, no status list. */
const roomBase = (id: string, type: string, subject: Record<string, unknown>) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://registry.trustoverip.org/dtg/context/v1'],
  id,
  type: ['VerifiableCredential', 'DTGCredential', type],
  issuer: ROOM,
  issuerScope: 'public',
  validFrom: '2026-10-27T04:51:49Z',
  validUntil: '2026-11-26T04:51:41Z',
  credentialSubject: { id: PERSONA_DID, ...subject },
  proof: { ...oneProof, verificationMethod: `${ROOM}#key-1`, created: '2026-10-27T04:51:49Z' },
})
/**
 * The two cards accepting a room offer leaves in the member's agent (`vtc/rooms/offers/accept`). The membership
 * card's types are a community's; the authority card grants room actions at the room's own DID. Shapes as a
 * lab agent holds them (VTA 0.65, community A's "Keyring lab open", 10-27).
 */
export const roomMembershipCard = roomBase('urn:uuid:65ccef05-99bf-46f7-854b-b4f2989c7623', 'MembershipCredential', {})
export const roomAuthorityCard = roomBase('urn:uuid:4de53d5f-2d7e-4b20-9634-51efcf4456dc', 'AuthorityCredential', {
  authority: { actions: ['read', 'write'], scope: ROOM },
})

export const membership: VtiMembership = {
  communityDid: COMMUNITY,
  personaDid: PERSONA_DID,
  role: 'member',
  vmc: membershipCard,
  roleVec: roleCard,
  grantedAt: '2026-09-26T09:00:00Z',
  via: 'vetting',
}

/** Generic records in memory, as Credo keeps them. */
export function fakeAgent() {
  const records: { id: string; content: Record<string, unknown>; tags: Record<string, string>; createdAt: Date }[] = []
  let next = 0
  const agent = {
    config: { logger: { warn: () => undefined, info: () => undefined } },
    genericRecords: {
      findAllByQuery: async (q: Record<string, string>) =>
        records.filter((r) => Object.entries(q).every(([k, v]) => r.tags[k] === v)),
      save: async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) =>
        void records.push({ id: `r${next++}`, content, tags, createdAt: new Date(Date.now() + next) }),
      update: async (r: { id: string }) => {
        const at = records.findIndex((x) => x.id === r.id)
        if (at >= 0) records[at] = { ...(r as (typeof records)[number]), createdAt: records[at].createdAt }
      },
      delete: async (r: { id: string }) => {
        const at = records.findIndex((x) => x.id === r.id)
        if (at >= 0) records.splice(at, 1)
      },
    },
  }
  return { agent: agent as never, records }
}

/** The community store, in memory. */
export function fakeCommunityStore(init: { memberships?: VtiMembership[]; held?: VtiHeldCredential[] } = {}) {
  const memberships = new Map((init.memberships ?? []).map((m) => [m.communityDid, m]))
  const held = [...(init.held ?? [])]
  const store = {
    listMemberships: async () => [...memberships.values()],
    getMembership: async (did: string) => memberships.get(did),
    saveMembership: async (m: VtiMembership) => void memberships.set(m.communityDid, m),
    listHeldCredentials: async () => [...held],
    saveHeldCredential: async (h: VtiHeldCredential) => void held.push(h),
  }
  return { store: store as unknown as VtiCommunityStore, memberships, held }
}

/**
 * A VTA's credential vault: `receive` refuses a proof set as a vault before
 * VTI #1868 does (400, "proof has no verificationMethod") unless
 * `acceptsProofSets`, refuses the ids in `refuses`, `query` answers by
 * purpose and `get` by id. `offline` makes every call go unanswered.
 */
export function fakeVault(
  options: {
    offline?: boolean
    /** A VTA on VTI #1868 (VTI-44): its vault verifies a proof set and keeps the card. */
    acceptsProofSets?: boolean
    /** Credential ids it refuses for some other reason (not a proof set). */
    refuses?: string[]
  } = {}
) {
  const kept = new Map<string, { credential: Record<string, unknown>; contextId?: string; purpose?: string }>()
  const calls: { type: string; payload: Record<string, unknown> }[] = []
  // As vta-vault receive.rs `infer_purpose` reads the type names.
  const purposeOf = (c: Record<string, unknown>): string | undefined => {
    const types = (c.type as string[]).map((t) => t.toLowerCase())
    if (types.some((t) => t.includes('membership'))) return 'membership'
    if (types.some((t) => t.includes('role'))) return 'role'
    if (types.some((t) => t.includes('endorsement'))) return 'endorsement'
    return undefined
  }
  const task = async <T>(type: string, payload: Record<string, unknown>): Promise<T> => {
    calls.push({ type, payload })
    if (options.offline) throw new Error('the VTA did not answer')
    if (type.endsWith('/receive/0.1')) {
      const credential = payload.credential as Record<string, unknown>
      if (Array.isArray(credential.proof) && !options.acceptsProofSets)
        throw Object.assign(new Error('proof has no verificationMethod'), { code: 'invalidCredential' })
      if (options.refuses?.includes(String(credential.id)))
        throw Object.assign(new Error('issuer proof verification failed'), { code: 'invalidCredential' })
      kept.set(String(payload.id ?? credential.id), {
        credential,
        contextId: payload.contextId as string | undefined,
        purpose: purposeOf(credential),
      })
      return { id: payload.id ?? credential.id, status: 'valid' } as T
    }
    if (type.endsWith('/query/0.1')) {
      return {
        credentials: [...kept.entries()]
          .filter(([, v]) =>
            payload.type !== undefined
              ? (v.credential.type as string[]).includes(String(payload.type))
              : v.purpose === payload.purpose
          )
          .map(([id, v]) => ({ id, purpose: v.purpose })),
      } as T
    }
    if (type.endsWith('/get/0.1')) return { credential: kept.get(String(payload.id))?.credential } as T
    // An agent from 0d3f268e answers get at 0.2 (only): the card as `credential`, with its `format`.
    if (type.endsWith('/get/0.2'))
      return { format: 'ldp_vc', credential: kept.get(String(payload.id))?.credential } as T
    throw Object.assign(new Error(`unknown task ${type}`), { code: 'unsupportedTask' })
  }
  return { task, kept, calls }
}
