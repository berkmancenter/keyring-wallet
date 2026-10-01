/**
 * A community's own identity check (228): vetted/1 issued by the community it
 * names, for a check it made itself (dtgwg-vsc-registry #24, 8edb3a81; tf
 * #697). It carries none of the vetter-only members — identityCommitment,
 * cardDigestMultibase, declaredRelationship: all three or none (the schema's
 * dependentRequired) — and cites the request in which the community recorded
 * the check, not a vetting session. It is not a vetter's statement: Keyring
 * keeps it as evidence, as it keeps a community's other cards, and never runs
 * the vetter's checks on it.
 *
 * fixtures/registry-vetted-1-community-desk-check.json is the registry's
 * predicates/vetted/1/examples/community-desk-check.json at 8edb3a81 (sha256
 * 147c6b28772b… as published), the same JSON, formatted. Its proof is
 * illustrative, so the card check is a stand-in here.
 */
import type { TFunction } from 'i18next'

import { isCommunityIdentityCheck } from '@bifold/trust-tasks'

import deskCheck from './fixtures/registry-vetted-1-community-desk-check.json'
import { communityCardDisplay } from '../screens/communityCardDisplay'
import { isCommunityCard } from '../module/vtiWalletCards'
import { CREDENTIAL_EXCHANGE_ISSUE, classifyCredential, receiveIssue } from '../module/vtiInbox'
import { VtiApplicant, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Json = Record<string, unknown>
const COMMUNITY = deskCheck.issuer
const PERSONA = deskCheck.credentialSubject.id
const copy = (): Json => JSON.parse(JSON.stringify(deskCheck))
const valueOf = (vc: Json) => ((vc.credentialSubject as Json).object as Json).value as Json
const withValue = (extra: Json): Json => {
  const vc = copy()
  Object.assign(valueOf(vc), extra)
  return vc
}
const VETTER_ONLY = {
  identityCommitment: 'zQmCommitment',
  cardDigestMultibase: 'zQmCardDigest',
  declaredRelationship: 'none',
}

describe('a community identity check is told apart from a vetter statement', () => {
  it('the registry example is one', () => {
    expect(isCommunityIdentityCheck(copy())).toBe(true)
    expect(classifyCredential(copy())).toMatchObject({
      kind: 'identity-check',
      communityDid: COMMUNITY,
      subjectDid: PERSONA,
    })
  })

  it('one not issued by the community it names is not, and stays a vetting statement', () => {
    const vc = { ...copy(), issuer: 'did:webvh:QmSomeoneElse:vetter.example' }
    expect(isCommunityIdentityCheck(vc)).toBe(false)
    expect(classifyCredential(vc).kind).toBe('vetting-statement')
  })

  it('one carrying any of the vetter-only members is not, and stays a vetting statement', () => {
    for (const [k, v] of Object.entries(VETTER_ONLY)) {
      const vc = withValue({ [k]: v })
      expect(isCommunityIdentityCheck(vc)).toBe(false)
      expect(classifyCredential(vc).kind).toBe('vetting-statement')
    }
    expect(classifyCredential(withValue(VETTER_ONLY)).kind).toBe('vetting-statement')
  })
})

describe('a community identity check delivered to the persona', () => {
  const deliver = (credential: Json, from: string) =>
    ({
      id: 'urn:uuid:m',
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from,
      body: { credential_response: { credential } },
    }) as never

  const setup = () => {
    const saved: Json[] = []
    const store = { saveHeldCredential: async (c: Json) => void saved.push(c) } as never
    const acceptStatement = jest.fn(async () => undefined)
    const checkCard = jest.fn(async () => undefined)
    const refused: string[] = []
    return { saved, store, acceptStatement, checkCard, refused }
  }

  it('is checked as a community card and kept as evidence, never through the vetter path', async () => {
    const s = setup()
    const kept = await receiveIssue(s.store, PERSONA, deliver(copy(), COMMUNITY), {
      acceptStatement: s.acceptStatement,
      checkCard: s.checkCard,
      onRefused: (_i, r) => s.refused.push(r),
    })
    expect(s.acceptStatement).not.toHaveBeenCalled()
    expect(s.checkCard).toHaveBeenCalledWith(expect.objectContaining({ issuer: COMMUNITY }), COMMUNITY)
    expect(kept.map((k) => k.kind)).toEqual(['identity-check'])
    expect(s.saved).toEqual([expect.objectContaining({ kind: 'identity-check', communityDid: COMMUNITY })])
  })

  it('is not kept from anyone but the community it names, as with any community card', async () => {
    const s = setup()
    await receiveIssue(s.store, PERSONA, deliver(copy(), 'did:webvh:QmSomeoneElse:x.example'), {
      acceptStatement: s.acceptStatement,
      checkCard: s.checkCard,
      onRefused: (_i, r) => s.refused.push(r),
    })
    expect(s.refused).toEqual(['issuerNotSender'])
    expect(s.saved).toEqual([])
    expect(s.acceptStatement).not.toHaveBeenCalled()
  })

  it('is not kept when its own check fails (proof, dates, status)', async () => {
    const s = setup()
    s.checkCard.mockResolvedValueOnce('proof' as never)
    await receiveIssue(s.store, PERSONA, deliver(copy(), COMMUNITY), {
      acceptStatement: s.acceptStatement,
      checkCard: s.checkCard,
      onRefused: (_i, r) => s.refused.push(r),
    })
    expect(s.refused).toEqual(['proof'])
    expect(s.saved).toEqual([])
  })

  it('a statement with only some vetter-only members still goes to the vetter path, as today', async () => {
    const s = setup()
    await receiveIssue(s.store, PERSONA, deliver(withValue({ identityCommitment: 'zQm' }), COMMUNITY), {
      acceptStatement: s.acceptStatement,
      checkCard: s.checkCard,
    })
    expect(s.acceptStatement).toHaveBeenCalledTimes(1)
    expect(s.saved).toEqual([])
  })

  it("an applicant's statement check leaves it alone, even from a community asked to vet", async () => {
    // The worst case: the community is itself one of the applicant's vetters.
    // Run through the vetter's checks, the example (no `id`) would be refused
    // as malformed and mark the request refused.
    let application = {
      communityDid: COMMUNITY,
      joinDid: PERSONA,
      minStatements: 1,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: 'AAEC',
      claims: { 'name.legal': 'Ada Lovelace' },
      startedAt: 't',
      requests: [{ vetterDid: COMMUNITY, requestDocumentId: 'urn:uuid:r', status: 'cardSent', updatedAt: 't' }],
    } as unknown as VettingApplication
    const store = {
      getApplication: async () => JSON.parse(JSON.stringify(application)),
      saveApplication: async (a: VettingApplication) => {
        application = JSON.parse(JSON.stringify(a))
      },
    } as unknown as VtiVettingStore
    const agent = { config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } } }
    const persona = { did: PERSONA, communityDid: COMMUNITY, vtaKeyIds: {}, kmsKeyIds: {} }
    const held: unknown[] = []
    const vti = new VtiApplicant(agent as never, persona as never, store, {
      saveHeldCredential: async (c: unknown) => void held.push(c),
    } as never)
    await vti.receiveStatement(deliver(copy(), COMMUNITY))
    expect(application.requests[0]).toMatchObject({ status: 'cardSent' })
    expect(application.requests[0].statementRefusal).toBeUndefined()
    expect(held).toEqual([])
  })
})

describe('in the Wallet', () => {
  const t = ((key: string, values?: Record<string, unknown>) =>
    values && Object.keys(values).some((k) => k !== 'interpolation')
      ? `${key}(${Object.entries(values)
          .filter(([k]) => k !== 'interpolation')
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key) as unknown as TFunction

  it('is a community card, named for the check and the community', () => {
    const vc = { ...copy(), id: 'urn:uuid:desk-check-1' }
    expect(isCommunityCard(vc)).toBe(true)
    const d = communityCardDisplay(vc, t)!
    expect(d.name).toMatch(/^Community\.CardIdentityCheckedBy\(community=/)
    expect(d.attributes?.['Community.CardRole']).toBeUndefined()
  })

  it('a vetter statement is still not a Wallet card', () => {
    const vc = { ...withValue(VETTER_ONLY), id: 'urn:uuid:statement-1' }
    expect(isCommunityCard(vc)).toBe(false)
  })
})
