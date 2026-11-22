/**
 * The Wallet's badge cards (docs/plans/member-badges-plan.md, Wallet): a community's badge credential is a badge card
 * after the community's passes, not an ordinary card and not a pass; with badges off (the kill) it is listed as the
 * ordinary credential it is. While the Wallet does not show badges (BADGES_IN_WALLET, the release's choice), a community's
 * badge is not listed at all, and nothing else changes. The badge is the credential lane's fixture, built to upstream's
 * shape.
 */
import { W3cCredentialRecord } from '@credo-ts/core'
import { render } from '@testing-library/react-native'
import React from 'react'
import { useCredentials } from '@bifold/react-hooks'

import ListCredentials from '../../src/screens/ListCredentials'
import { BADGES_IN_WALLET, MEMBER_BADGES } from '../../src/modules/badges/badgesSwitch'
import { badgeCredential } from '../../src/modules/trust-tasks/__tests__/fixtures/badgeCredential'
import { testIdWithKey } from '../../src/utils/testable'
import { membershipCard } from '../helpers/cardVault'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-localize', () => {})
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockUseOpenId = jest.fn()
jest.mock('../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: () => mockUseOpenId(),
}))
jest.mock('../../src/modules/trust-tasks/module/useCommunityBrand', () => ({
  useCommunityBrand: () => ({
    known: true,
    value: { color: '#265373', pattern: 'waves', monogram: 'HT', fromAccent: false },
  }),
}))
// An ordinary credential's card, standing in so a row can count them.
jest.mock('../../src/components/misc/CredentialCardGen', () => {
  const { Text: MockText } = jest.requireActual('react-native')
  return { __esModule: true, default: () => <MockText testID="OrdinaryCard">card</MockText> }
})

const mockCredentials = useCredentials as jest.Mock
const id = testIdWithKey

function recordOf(credential: Record<string, unknown>, i: number): W3cCredentialRecord {
  const record = new W3cCredentialRecord({ credentialInstances: [{ credential: credential as never }] })
  record.createdAt = new Date(Date.parse('2026-11-10T09:00:00Z') + i * 60_000)
  return record
}
const proof = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-26T09:00:00Z',
  verificationMethod: 'did:example:community#key-0',
  proofPurpose: 'assertionMethod',
  proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKM7Mz2HnNhqFz5Rakm',
}
const badge = () => recordOf(badgeCredential(), 1)
const membership = () => recordOf({ ...membershipCard, id: 'urn:uuid:card-m', proof }, 2)
const other = () =>
  recordOf(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'urn:uuid:other',
      type: ['VerifiableCredential', 'ExampleCredential'],
      issuer: 'did:example:issuer',
      validFrom: '2026-11-01T00:00:00Z',
      credentialSubject: { id: 'did:example:me' },
      proof,
    },
    3
  )

function wallet(records: W3cCredentialRecord[]) {
  mockUseOpenId.mockReturnValue({
    openIdState: { w3cCredentialRecords: records, sdJwtVcRecords: [], mdocVcRecords: [], isLoading: false },
  } as never)
  mockCredentials.mockReturnValue({ records: [], loading: false })
  return render(
    <BasicAppContext>
      <ListCredentials />
    </BasicAppContext>
  )
}

const SHIPPED_IN_WALLET = { ...BADGES_IN_WALLET }

describe('the Wallet’s badge cards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    MEMBER_BADGES.on = true
    MEMBER_BADGES.remoteOff = false
    // These rows are the Wallet showing badges: the control for the rows below, where it does not.
    Object.assign(BADGES_IN_WALLET, { on: true, remoteOff: false })
  })
  afterAll(() => {
    MEMBER_BADGES.on = true
    MEMBER_BADGES.remoteOff = false
    Object.assign(BADGES_IN_WALLET, SHIPPED_IN_WALLET)
  })

  test('a badge is a badge card, not an ordinary card and not a pass', async () => {
    const tree = wallet([badge()])
    expect(await tree.findAllByTestId(id('BadgeCard'))).toHaveLength(1)
    expect(tree.getByTestId(id('BadgeCardName')).props.children).toBe('Helper')
    expect(tree.queryByTestId('OrdinaryCard')).toBeNull()
    expect(tree.queryByTestId(id('CommunityPass'))).toBeNull()
  })

  test('beside a community’s passes and an ordinary credential, each keeps its own kind', async () => {
    const tree = wallet([badge(), membership(), other()])
    expect(await tree.findAllByTestId(id('BadgeCard'))).toHaveLength(1)
    expect(tree.getAllByTestId(id('CommunityPass'))).toHaveLength(1)
    expect(tree.getAllByTestId('OrdinaryCard')).toHaveLength(1)
  })

  test('a badge alone is not "no credentials"', async () => {
    const tree = wallet([badge()])
    await tree.findAllByTestId(id('BadgeCard'))
    expect(tree.queryByText(/EmptyList|No credentials/i)).toBeNull()
  })

  test.each([
    ['remoteOff', { on: true, remoteOff: true }],
    ['not on', { on: false, remoteOff: false }],
  ])('%s: the badge is listed as an ordinary credential, and no badge card is drawn', async (_name, value) => {
    Object.assign(MEMBER_BADGES, value)
    const tree = wallet([badge()])
    expect(await tree.findAllByTestId('OrdinaryCard')).toHaveLength(1)
    expect(tree.queryByTestId(id('BadgeCard'))).toBeNull()
  })
})

/** An Open Badge that did not come from a community: its achievement names no community badge id. */
const elsewhere = () => {
  const vc = badgeCredential({ id: 'urn:uuid:elsewhere' })
  const subject = vc.credentialSubject as { achievement: Record<string, unknown> }
  subject.achievement = { ...subject.achievement, id: 'https://issuer.example/achievements/first-aid' }
  return recordOf(vc, 4)
}

describe('the Wallet while it does not show badges', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.assign(MEMBER_BADGES, { on: true, remoteOff: false })
    Object.assign(BADGES_IN_WALLET, SHIPPED_IN_WALLET)
  })
  afterAll(() => {
    Object.assign(MEMBER_BADGES, { on: true, remoteOff: false })
    Object.assign(BADGES_IN_WALLET, SHIPPED_IN_WALLET)
  })

  test('the release ships it not showing them', () => {
    expect(SHIPPED_IN_WALLET).toEqual({ on: false, remoteOff: false })
  })

  test('a community badge is neither a badge card nor an ordinary card; passes and other credentials stay', async () => {
    const tree = wallet([badge(), membership(), other()])
    expect(await tree.findAllByTestId(id('CommunityPass'))).toHaveLength(1)
    expect(tree.getAllByTestId('OrdinaryCard')).toHaveLength(1)
    expect(tree.queryByTestId(id('BadgeCard'))).toBeNull()
  })

  test('turned off remotely while on, a community badge is not listed', async () => {
    Object.assign(BADGES_IN_WALLET, { on: true, remoteOff: true })
    const tree = wallet([badge(), other()])
    expect(await tree.findAllByTestId('OrdinaryCard')).toHaveLength(1)
    expect(tree.queryByTestId(id('BadgeCard'))).toBeNull()
  })

  test('with badges also killed, a community badge is still not listed (not as an ordinary credential)', async () => {
    Object.assign(MEMBER_BADGES, { on: true, remoteOff: true })
    const tree = wallet([badge(), other()])
    expect(await tree.findAllByTestId('OrdinaryCard')).toHaveLength(1)
    expect(tree.queryByTestId(id('BadgeCard'))).toBeNull()
  })

  test('an Open Badge from elsewhere is listed as the credential it is', async () => {
    const tree = wallet([elsewhere(), badge()])
    expect(await tree.findAllByTestId('OrdinaryCard')).toHaveLength(1)
    expect(tree.queryByTestId(id('BadgeCard'))).toBeNull()
  })
})
