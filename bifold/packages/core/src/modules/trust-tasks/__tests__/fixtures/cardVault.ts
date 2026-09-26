/**
 * Fixtures for agent-kept cards (vtiCardVault), shared by the module's tests
 * and the screens' (Wallet cards, "Kept by your agent", "Get your cards from
 * your agent"): a persona, its community, one card per vault state, an agent
 * whose generic records live in memory, a community store, and a vault that
 * answers as a VTA does.
 */
import type { VtiCommunityStore, VtiHeldCredential, VtiMembership } from '../../module/VtiCommunityStore'
import type { VtiPersona } from '../../module/VtiIdentityStore'
import { seedCardVaultStateForTests, type CardVaultState } from '../../module/vtiCardVault'

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
const oneProof = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofPurpose: 'assertionMethod' }
const proofSet = [oneProof, { type: 'DataIntegrityProof', cryptosuite: 'mldsa44-jcs-2024' }]

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
/** A vetter grant from a community that signs with two keys: the vault refuses its proof set (VTI-44 (e)). */
export const vetterGrantProofSet = base(
  'urn:uuid:33333333-3333-4333-8333-333333333333',
  'EndorsementCredential',
  { endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: COMMUNITY } },
  proofSet
)

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
        if (at >= 0) records[at] = { ...(r as never), createdAt: records[at].createdAt }
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
 * A VTA's credential vault: `receive` refuses a proof set as the vault does
 * today (400, "proof has no verificationMethod"), `query` answers by purpose
 * and `get` by id. `offline` makes every call go unanswered.
 */
export function fakeVault(options: { offline?: boolean } = {}) {
  const kept = new Map<string, { credential: Record<string, unknown>; contextId?: string; purpose: string }>()
  const calls: { type: string; payload: Record<string, unknown> }[] = []
  const purposeOf = (c: Record<string, unknown>) =>
    (c.type as string[]).includes('MembershipCredential') ? 'membership' : 'endorsement'
  const task = async <T>(type: string, payload: Record<string, unknown>): Promise<T> => {
    calls.push({ type, payload })
    if (options.offline) throw new Error('the VTA did not answer')
    if (type.endsWith('/receive/0.1')) {
      const credential = payload.credential as Record<string, unknown>
      if (Array.isArray(credential.proof))
        throw Object.assign(new Error('proof has no verificationMethod'), { code: 'invalidCredential' })
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
          .filter(([, v]) => v.purpose === payload.purpose)
          .map(([id, v]) => ({ id, purpose: v.purpose })),
      } as T
    }
    if (type.endsWith('/get/0.1')) return { credential: kept.get(String(payload.id))?.credential } as T
    throw Object.assign(new Error(`unknown task ${type}`), { code: 'unsupportedTask' })
  }
  return { task, kept, calls }
}
