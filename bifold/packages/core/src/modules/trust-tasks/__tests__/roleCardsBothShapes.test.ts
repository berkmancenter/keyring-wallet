/**
 * 228: a community role grant is read in both shapes — the `CommunityRole`
 * endorsement Keyring has always read, and DTG Credentials v1's role VAC
 * (`role:<name>` actions at the community's DID; VTI 0.47.0, #1859) — by the
 * inbox, the Wallet, a join's verdict and an applicant's eligibility check.
 *
 * Old shape: the grant inside `vti-upstream-eligibility.json` (signed by
 * vta-sdk before the cut). New shape: `dtg-v1-minted-eligibility.json`, minted
 * with VTI's own issuing code at 439a0333 (vta-service-v0.47.0): the VTC's
 * `issue_role_action` for the grant and vta-sdk `build_eligibility_vp` for the
 * vetter's presentation. Crate-minted, not from a deployed VTC; its parties are
 * did:keys from fixed seeds (the vetter's is 0x7E × 32), so everything verifies
 * offline and the vetter can re-sign a presentation here.
 */
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: jest.fn(async () => undefined), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
// eslint-disable-next-line import/order
import { ed25519 } from '@noble/curves/ed25519.js'
// eslint-disable-next-line import/order
import { communityRoleCard, confersRole } from '@bifold/trust-tasks'
// eslint-disable-next-line import/order
import minted from './fixtures/dtg-v1-minted-eligibility.json'
// eslint-disable-next-line import/order
import upstream from './fixtures/vti-upstream-eligibility.json'
// eslint-disable-next-line import/order
import { buildEligibilityPresentation, verifyEligibilityPresentation } from '../module/vtiEligibility'
// eslint-disable-next-line import/order
import { classifyCredential, roleNameOf } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { membershipFromVerdict } from '../module/vtiJoin'
// eslint-disable-next-line import/order
import { isCommunityCard } from '../module/vtiWalletCards'

type Json = Record<string, unknown>

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const resolver = {
  config: { logger },
  dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
}

const vac = minted.vetterGrant as Json
const oldGrant = ((upstream.vp as Json).verifiableCredential as Json[])[0]
const { community, vetter, applicant } = minted.parties
const expectations = (over: Partial<Parameters<typeof verifyEligibilityPresentation>[2]> = {}) => ({
  vetter,
  community,
  role: 'vetter',
  challenge: minted.eligibility.challenge,
  domain: applicant,
  // A day into the grant's window.
  now: new Date(Date.parse(String(vac.validFrom)) + 24 * 3600 * 1000),
  ...over,
})

/** The minted vetter (seed 0x7E × 32), able to sign as its did:key — to re-present an altered grant. */
function mintedVetter() {
  const secret = new Uint8Array(32).fill(0x7e)
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const verificationMethodId = DidKey.fromDid(did).didDocument.verificationMethod?.[0]?.id as string
  const agent = {
    ...resolver,
    dependencyManager: {
      resolve: () => ({ sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }) }),
    },
  }
  const present = (grant: Json) =>
    buildEligibilityPresentation(agent as never, { did, verificationMethodId, kmsKeyId: 'minted-vetter' }, [grant], {
      nonce: minted.eligibility.challenge,
      domain: applicant,
    })
  return { did, present }
}

describe('a role grant, read in either shape', () => {
  it('names the community and the roles: the endorsement, and the VAC', () => {
    expect(communityRoleCard(oldGrant)).toEqual({
      shape: 'endorsement',
      communityDid: upstream.eligibility.community,
      roles: ['vetter'],
    })
    expect(communityRoleCard(vac)).toEqual({ shape: 'vac', communityDid: community, roles: ['vetter'] })
    expect(confersRole(communityRoleCard(vac), 'vetter')).toBe(true)
    expect(confersRole(communityRoleCard(vac), 'custom:vetter')).toBe(true)
    expect(confersRole(communityRoleCard(vac), 'admin')).toBe(false)
  })

  // vta-sdk community_roles: the community's own grant, not an attenuation, and only role: actions.
  it.each([
    ['attenuated from a parent', { parent: 'urn:uuid:a-parent-vac' }],
    ['scoped somewhere other than its issuer', { scope: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' }],
    ['conferring no role: action', { actions: ['vtc:members:read'] }],
    ['conferring an empty role', { actions: ['role:'] }],
  ])('is not a community role grant when %s', (_why, change) => {
    const subject = vac.credentialSubject as Json
    const altered = {
      ...vac,
      credentialSubject: { ...subject, authority: { ...(subject.authority as Json), ...change } },
    }
    expect(communityRoleCard(altered)).toBeUndefined()
  })

  it('lists every role a VAC confers', () => {
    const subject = vac.credentialSubject as Json
    const both = {
      ...vac,
      credentialSubject: {
        ...subject,
        authority: { ...(subject.authority as Json), actions: ['role:moderator', 'role:vetter'] },
      },
    }
    expect(communityRoleCard(both)?.roles).toEqual(['moderator', 'vetter'])
    expect(classifyCredential(both).kind).toBe('vetter-grant')
    expect(roleNameOf(both)).toBe('moderator')
  })
})

describe('the phone keeps a VAC grant as it kept an endorsement', () => {
  it('classifies it as the vetter grant, for its community', () => {
    expect(classifyCredential(vac)).toMatchObject({ kind: 'vetter-grant', communityDid: community, subjectDid: vetter })
    expect(classifyCredential(oldGrant)).toMatchObject({ kind: 'vetter-grant' })
  })

  it('classifies a VAC conferring another role as a role card', () => {
    const subject = vac.credentialSubject as Json
    const moderator = {
      ...vac,
      credentialSubject: { ...subject, authority: { ...(subject.authority as Json), actions: ['role:moderator'] } },
    }
    expect(classifyCredential(moderator)).toMatchObject({ kind: 'role', communityDid: community })
    expect(roleNameOf(moderator)).toBe('moderator')
  })

  it('shows it in the Wallet as a community card', () => {
    expect(isCommunityCard(vac)).toBe(true)
    expect(isCommunityCard(minted.vetterMembership as Json)).toBe(true)
    expect(isCommunityCard(minted.vettingStatement as Json)).toBe(false)
  })

  it('keeps the role card a join verdict carries as `roleVac` (decide/0.1 as recast by tf #691)', () => {
    const verdict = { decision: 'allow', with: { vmc: minted.vetterMembership, roleVac: vac } } as never
    expect(membershipFromVerdict(community, vetter, verdict, 'invitation')).toMatchObject({
      role: 'vetter',
      roleVec: vac,
      vmc: minted.vetterMembership,
    })
  })
})

describe('an applicant judging a vetter who presents a VAC grant', () => {
  it('accepts the presentation the VTI SDK built (build_eligibility_vp)', async () => {
    const vp = minted.eligibilityVp as unknown as Json
    await expect(verifyEligibilityPresentation(resolver as never, vp, expectations())).resolves.toMatchObject({
      ok: true,
      credentialId: vac.id,
      validUntil: vac.validUntil,
    })
  })

  it('accepts the same grant re-presented by the vetter here (the re-signing path is sound)', async () => {
    const v = mintedVetter()
    expect(v.did).toBe(vetter)
    await expect(
      verifyEligibilityPresentation(resolver as never, await v.present(vac), expectations())
    ).resolves.toMatchObject({
      ok: true,
    })
  })

  it('still accepts the endorsement-shape presentation it always did', async () => {
    const e = upstream.eligibility
    const result = await verifyEligibilityPresentation(resolver as never, upstream.vp as unknown as Json, {
      vetter: e.vetter,
      community: e.community,
      role: e.role,
      challenge: e.challenge,
      domain: e.domain,
      now: new Date(e.now),
    })
    expect(result).toMatchObject({ ok: true })
  })

  // vta-sdk 0.47 verify_role_credential (eligibility.rs:303-336).
  it.each([
    ['declaring a scope other than public', { issuerScope: 'directed' }, 'grantMalformed'],
    ['without issuerScope', { issuerScope: undefined }, 'grantMalformed'],
    [
      'under the old context',
      { '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'] },
      'grantMalformed',
    ],
    ['altered after the community signed it', { validUntil: '2099-01-01T00:00:00Z' }, 'grantProof'],
  ])('refuses a VAC grant %s', async (_why, change, reason) => {
    const v = mintedVetter()
    const result = await verifyEligibilityPresentation(
      resolver as never,
      await v.present({ ...vac, ...change }),
      expectations()
    )
    expect(result).toMatchObject({ ok: false, reason })
  })

  it('refuses it for a role the VAC does not confer', async () => {
    const vp = minted.eligibilityVp as unknown as Json
    await expect(
      verifyEligibilityPresentation(resolver as never, vp, expectations({ role: 'custom:senior-vetter' }))
    ).resolves.toMatchObject({ ok: false, reason: 'noRoleCredential' })
  })
})
