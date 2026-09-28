/**
 * The check a delivered card goes through (vtiDeliveredCheck), and the words a
 * person reads when a card is not kept (refusedCardNotice).
 */
import i18n from 'i18next'

import en from '../../../localization/en/en.json'
import { checkDeliveredCard, VtiCardStatusUnreadable } from '../module/vtiDeliveredCheck'
import { communityTarget } from '../module/vtiCommunityLink'
import { refusedCardWords } from '../screens/refusedCardNotice'

const mockVerify = jest.fn()
const mockStatus = jest.fn()
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  verifyDocumentProof: (...a: unknown[]) => mockVerify(...a),
}))
jest.mock('../module/vtiStatusList', () => ({ checkCredentialStatus: (...a: unknown[]) => mockStatus(...a) }))

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
const NOW = new Date('2026-09-27T09:00:00Z')
const card = (over: Record<string, unknown> = {}) => ({
  type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
  issuer: COMMUNITY,
  validFrom: '2026-09-26T09:00:00Z',
  validUntil: '2026-10-26T09:00:00Z',
  credentialSubject: { id: 'did:webvh:QmPersona:dids.example:p' },
  proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022' },
  ...over,
})
const agent = {} as never

describe('checking a delivered card', () => {
  beforeEach(() => {
    mockVerify.mockReset().mockResolvedValue(true)
    mockStatus
      .mockReset()
      .mockResolvedValue({ state: 'ok', checkedAt: NOW.toISOString(), index: 1, purpose: 'revocation' })
  })

  it('keeps a card whose proof verifies under the community and that is current and not withdrawn', async () => {
    await expect(checkDeliveredCard(agent, card(), COMMUNITY, { now: NOW })).resolves.toBeUndefined()
    expect(mockVerify).toHaveBeenCalledWith(agent, card(), COMMUNITY)
  })

  it('keeps a card that names no status list', async () => {
    mockStatus.mockResolvedValue({ state: 'none', checkedAt: NOW.toISOString() })
    await expect(checkDeliveredCard(agent, card(), COMMUNITY, { now: NOW })).resolves.toBeUndefined()
  })

  it('refuses a card whose proof does not verify', async () => {
    mockVerify.mockResolvedValue(false)
    await expect(checkDeliveredCard(agent, card(), COMMUNITY, { now: NOW })).resolves.toBe('proof')
  })

  it('refuses a card past its validity, or not yet valid, allowing a minute of clock skew', async () => {
    await expect(
      checkDeliveredCard(agent, card({ validUntil: '2026-09-27T08:58:00Z' }), COMMUNITY, { now: NOW })
    ).resolves.toBe('expired')
    await expect(
      checkDeliveredCard(agent, card({ validFrom: '2026-09-27T09:02:00Z' }), COMMUNITY, { now: NOW })
    ).resolves.toBe('notYetValid')
    await expect(
      checkDeliveredCard(agent, card({ validFrom: '2026-09-27T09:00:30Z' }), COMMUNITY, { now: NOW })
    ).resolves.toBeUndefined()
  })

  it('refuses a card its community has withdrawn', async () => {
    mockStatus.mockResolvedValue({ state: 'revoked', checkedAt: NOW.toISOString(), index: 1, purpose: 'revocation' })
    await expect(checkDeliveredCard(agent, card(), COMMUNITY, { now: NOW })).resolves.toBe('revoked')
  })

  it('leaves the card for redelivery when its status list cannot be read now', async () => {
    mockStatus.mockResolvedValue({ state: 'unknown', checkedAt: NOW.toISOString(), reason: 'fetch failed' })
    await expect(checkDeliveredCard(agent, card(), COMMUNITY, { now: NOW })).rejects.toBeInstanceOf(
      VtiCardStatusUnreadable
    )
  })
})

describe('the words a person reads', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  })
  beforeEach(() => communityTarget.clear())
  const t = i18n.t.bind(i18n)

  it('names the community by its published name, never by its DID', () => {
    communityTarget.publishedName(COMMUNITY, 'Keyring Test Community')
    const words = refusedCardWords('proof', COMMUNITY, t)
    expect(words).toBe(
      "A card from Keyring Test Community didn't check out, so Keyring didn't keep it. Ask the community to send it again."
    )
    expect(words).not.toMatch(/did:|vtc\.example/)
  })

  it('starts a sentence with an unnamed community in capitals', () => {
    expect(refusedCardWords('revoked', COMMUNITY, t)).toBe(
      "A community has withdrawn a card it sent, so Keyring didn't keep it."
    )
  })
})
