/**
 * A community's cards in the Wallet (226): named for what they are and for
 * whom, issued by the community by its name (never a DID or host), dated from
 * the card; Details offers the community, not "Remove"; and a card that no
 * longer stands says on the community card what happened to it.
 */
import { W3cCredentialRecord } from '@credo-ts/core'
import { act, fireEvent, render } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import {
  COMMUNITY,
  fakeAgent,
  membership,
  membershipCard,
  roleCard,
  seedCardVaultState,
} from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import { getCredentialForDisplay } from '../../openid/display'
import { isPeerVrcCredential, isVrcModuleCredential } from '../../vrc/credentialTypes'
import { recordCardRevocation, resetCardStanding } from '../module/vtiCardStanding'
import { resetCardVaultCache } from '../module/vtiCardVault'
import { communityTarget } from '../module/vtiCommunityLink'
import { CommunityCard, communityCardKey } from '../screens/CommunityCard'
import { localDate } from '../screens/localTime'
import { CommunityCardDetails, communityCardOf } from '../screens/CommunityCardDetails'
import {
  communityCardDisplay,
  registerCommunityCardDisplay,
  unregisterCommunityCardDisplay,
} from '../screens/communityCardDisplay'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const t = ((key: string, values?: Record<string, unknown>) =>
  values && Object.keys(values).some((k) => k !== 'interpolation')
    ? `${key}(${Object.entries(values)
        .filter(([k]) => k !== 'interpolation')
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key) as unknown as TFunction

const vetterGrant = {
  ...roleCard,
  id: 'urn:uuid:33333333-3333-4333-8333-333333333333',
  credentialSubject: {
    ...(roleCard.credentialSubject as Record<string, unknown>),
    endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: COMMUNITY },
  },
}
const peerVrc = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'urn:uuid:peer',
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:2.someone',
  validFrom: '2026-09-26T09:00:00Z',
  credentialSubject: { id: 'did:peer:2.me' },
}
const key = communityCardKey(COMMUNITY)

// A proof as a community signs one (the shared fixtures' proof is only a sketch,
// and Credo's W3C record validates the proof when the Wallet reads it).
const signed = (proof: unknown) => ({
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-26T09:00:00Z',
  verificationMethod: `${COMMUNITY}#key-0`,
  proofPurpose: 'assertionMethod',
  proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKM7Mz2HnNhqFz5Rakm',
  ...(proof as object),
})
const realMembership = { ...membershipCard, proof: signed({}) }
const realVetterGrantProofSet = {
  ...vetterGrant,
  proof: [signed({}), signed({ cryptosuite: 'mldsa44-jcs-2024', verificationMethod: `${COMMUNITY}#key-1` })],
}
const realPeerVrc = { ...peerVrc, proof: { ...signed({}), verificationMethod: 'did:peer:2.someone#key-1' } }

describe('a community card as the Wallet reads it', () => {
  beforeEach(() => communityTarget.clear())
  // The app registers with its i18n; here the words are the keys.
  beforeAll(() => {
    unregisterCommunityCardDisplay()
    registerCommunityCardDisplay(t)
  })
  afterAll(() => unregisterCommunityCardDisplay())

  it('with no words loaded, a card keeps the generic display rather than "undefined"', () => {
    const none = (() => undefined) as unknown as TFunction
    expect(communityCardDisplay(membershipCard, none)).toBeUndefined()
  })

  it('names the membership card for the community, issued by the community by name', () => {
    const d = communityCardDisplay(membershipCard, t)!
    // Unnamed so far: said to be, with its DID's path to tell it apart, never its host.
    expect(d.name).toBe('Community.CardMemberOf(community=Community.UnnamedRef(ref=keyring-test-vtc))')
    expect(d.issuerName).toBe('Community.UnnamedRef(ref=keyring-test-vtc)')
    expect(JSON.stringify(d)).not.toMatch(/vtc\.example|did:webvh/)
    expect(d.attributes).toEqual({
      'Community.CardCommunity': 'Community.UnnamedRef(ref=keyring-test-vtc)',
      // In the phone's time zone, month named (IN-58).
      'Community.CardSince': localDate('2026-09-26T09:00:00Z'),
      'Community.CardUntil': localDate('2026-10-26T09:00:00Z'),
    })
  })

  it('a role card and a vetter grant say which role, in words rather than the raw role', () => {
    expect(communityCardDisplay(roleCard, t)!.name).toBe(
      'Community.CardRoleIn(community=Community.UnnamedRef(ref=keyring-test-vtc),role=Community.RoleMember)'
    )
    expect(communityCardDisplay(vetterGrant, t)!.name).toBe(
      'Community.CardVetterFor(community=Community.UnnamedRef(ref=keyring-test-vtc))'
    )
    expect(communityCardDisplay(vetterGrant, t)!.attributes?.['Community.CardRole']).toBe('Community.RoleVetter')
  })

  it('reads a community\'s own role as words: "custom:senior-vetter" is "Senior vetter"', () => {
    const custom = {
      ...roleCard,
      credentialSubject: {
        ...(roleCard.credentialSubject as Record<string, unknown>),
        endorsement: { type: 'CommunityRole', role: 'custom:senior-vetter', communityDid: COMMUNITY },
      },
    }
    const d = communityCardDisplay(custom, t)!
    expect(d.name).toBe('Community.CardRoleIn(community=Community.UnnamedRef(ref=keyring-test-vtc),role=Senior vetter)')
    expect(d.attributes?.['Community.CardRole']).toBe('Senior vetter')
  })

  it('is shown in the Wallet at all, and is not a contact (#169 in this tree)', () => {
    // The Wallet hides the relationship family and Contacts lists peer VRCs;
    // keyed on DTGCredential (before #169) the mirrored copies were hidden.
    for (const card of [membershipCard, roleCard, vetterGrant]) {
      expect(isVrcModuleCredential(card)).toBe(false)
      expect(isPeerVrcCredential(card)).toBe(false)
    }
  })

  it('leaves every other credential to the generic display', () => {
    expect(communityCardDisplay(peerVrc, t)).toBeUndefined()
    expect(communityCardOf(peerVrc)).toBeUndefined()
  })

  it('reaches the Wallet: the record the mirror stores reads with that name, issuer and dates', () => {
    const record = new W3cCredentialRecord({ credentialInstances: [{ credential: realMembership as never }] })
    const shown = getCredentialForDisplay(record)
    expect(shown.display.name).toMatch(/CardMemberOf/)
    expect(shown.display.issuer.name).not.toBe('Unknown')
    expect(shown.display.issuer.name).not.toMatch(/did:/)
    // A VCDM 2.0 card has validFrom, not issuanceDate: no Invalid Date.
    expect(shown.validFrom?.toISOString()).toBe('2026-09-26T09:00:00.000Z')
    expect(shown.validUntil?.toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(shown.metadata.issuer).toBe(COMMUNITY)
  })

  it('a peer VRC through the same path keeps its generic display', () => {
    const record = new W3cCredentialRecord({ credentialInstances: [{ credential: realPeerVrc as never }] })
    expect(getCredentialForDisplay(record).display.name).not.toMatch(/Card/)
  })

  it('a vetter grant signed with a proof set reads too', () => {
    const record = new W3cCredentialRecord({ credentialInstances: [{ credential: realVetterGrantProofSet as never }] })
    expect(getCredentialForDisplay(record).display.name).toMatch(/CardVetterFor/)
  })
})

describe("a community card's Details", () => {
  beforeEach(() => resetCardVaultCache())

  it('says where it is kept, that leaving the community gives it up, and opens the community', () => {
    seedCardVaultState(membershipCard.id as string, { state: 'kept', at: '2026-09-26T10:00:00Z' })
    const open = jest.fn()
    const tree = render(
      <BasicAppContext>
        <CommunityCardDetails card={membershipCard} onOpenCommunity={open} />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey(`AgentCardKept_membership_${key}`))).toHaveTextContent('VtaLink.CardKept')
    expect(tree.getByTestId(testIdWithKey('CommunityCardFrom'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(testIdWithKey('CommunityCardOpenCommunity')))
    expect(open).toHaveBeenCalledWith(COMMUNITY)
  })

  it('shows nothing for a credential that is not a community card', () => {
    const tree = render(
      <BasicAppContext>
        <CommunityCardDetails card={peerVrc} onOpenCommunity={jest.fn()} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey('CommunityCardDetails'))).toBeNull()
  })
})

describe('what happened to a card that no longer stands, on the community card', () => {
  beforeEach(() => {
    resetCardVaultCache()
    resetCardStanding()
  })

  const renderCard = (m = membership) =>
    render(
      <BasicAppContext>
        <CommunityCard
          communityDid={COMMUNITY}
          membership={m}
          invited={false}
          vetter={false}
          onOpen={jest.fn()}
          onPrimary={jest.fn()}
        />
      </BasicAppContext>
    )

  it('revoked: "<community> withdrew this card"; its status cleared: kept again', async () => {
    const { agent } = fakeAgent()
    const tree = renderCard()
    expect(tree.queryByTestId(testIdWithKey(`AgentCardHistory_membership_${key}`))).toBeNull()
    await act(async () => {
      await recordCardRevocation(agent as never, membershipCard.id as string, true, '2026-09-27T08:00:00Z')
    })
    expect(tree.getByTestId(testIdWithKey(`AgentCardHistory_membership_${key}`))).toHaveTextContent(
      /VtaLink\.CardWithdrawn/
    )
    expect(tree.queryByTestId(testIdWithKey(`AgentCardKept_membership_${key}`))).toBeNull()
    await act(async () => {
      await recordCardRevocation(agent as never, membershipCard.id as string, false, '2026-09-27T09:00:00Z')
    })
    expect(tree.queryByTestId(testIdWithKey(`AgentCardHistory_membership_${key}`))).toBeNull()
    expect(tree.getByTestId(testIdWithKey(`AgentCardKept_membership_${key}`))).toBeTruthy()
  })

  it('expired: "Your membership ended on <date>"', () => {
    const ended = { ...membershipCard, id: 'urn:uuid:ended', validUntil: '2023-06-01T00:00:00Z' }
    const tree = renderCard({ ...membership, vmc: ended, roleVec: undefined })
    expect(tree.getByTestId(testIdWithKey(`AgentCardHistory_membership_${key}`))).toHaveTextContent(
      /VtaLink\.CardMembershipEnded/
    )
  })
})
