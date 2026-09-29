/**
 * A community's removal notice and join receipt (vtiCommunityNotices): checked
 * as the community's own operational documents, as openvtc checks them
 * (openvtc-core operational.rs `check_envelope`), then applied once.
 */
import i18n from 'i18next'
import { DeviceEventEmitter } from 'react-native'

import en from '../../../localization/en/en.json'
import { communityTarget } from '../module/vtiCommunityLink'
import { receiveCommunityNotice, REMOVAL_NOTICE, SUBMIT_RECEIPT } from '../module/vtiCommunityNotices'
import type { JoinSubmission, VtiCommunityStore, VtiMembership } from '../module/VtiCommunityStore'
import { removedWords } from '../screens/removedNotice'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
const PERSONA = 'did:webvh:QmPersona:dids.example:negative-weird'
const NOW = Date.parse('2026-09-27T09:00:00Z')
const agent = { config: { logger: { warn: jest.fn() } } } as never
const verified = async () => true

const membership: VtiMembership = {
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  role: 'member',
  vmc: { id: 'urn:vmc' },
  grantedAt: '2026-09-20T10:00:00Z',
  via: 'vetting',
}

function store(init: { membership?: VtiMembership; submission?: JoinSubmission } = {}) {
  let m = init.membership
  let s = init.submission
  const st = {
    getMembership: jest.fn(async () => m),
    saveMembership: jest.fn(async (next: VtiMembership) => void (m = next)),
    getSubmission: jest.fn(async () => s),
    saveSubmission: jest.fn(async (next: JoinSubmission) => void (s = next)),
  }
  return { st: st as unknown as VtiCommunityStore, membership: () => m, submission: () => s }
}

// The document as vtc-service builds it (ceremony/removal_notice.rs:125-138, fixture :191-211).
const notice = (payload: Record<string, unknown> = {}, doc: Record<string, unknown> = {}) => ({
  type: REMOVAL_NOTICE,
  from: COMMUNITY,
  body: {
    id: 'urn:uuid:7a1f0c3e-2b4d-4e6f-8a9b-0c1d2e3f4a5b',
    type: REMOVAL_NOTICE,
    issuer: COMMUNITY,
    recipient: PERSONA,
    issuedAt: '2026-09-27T08:59:00Z',
    payload: {
      did: PERSONA,
      code: 'adminRemoved',
      disposition: 'tombstone',
      reason: 'Repeated code-of-conduct breach.',
      decidedAt: '2026-09-27T08:58:30Z',
      decidedBy: 'did:webvh:QmAdmin:dids.example:admin',
      ...payload,
    },
    proof: { type: 'DataIntegrityProof', proofPurpose: 'authentication' },
    ...doc,
  },
})

describe("a community's removal notice", () => {
  afterEach(() => jest.restoreAllMocks())

  it('marks the membership removed, keeping who decided, when and why, and says so', async () => {
    const { st, membership: held } = store({ membership })
    const emit = jest.spyOn(DeviceEventEmitter, 'emit')
    await expect(receiveCommunityNotice(agent, st, PERSONA, notice(), { now: NOW, verify: verified })).resolves.toBe(
      'removed'
    )
    expect(held()?.removal).toEqual({
      code: 'adminRemoved',
      reason: 'Repeated code-of-conduct breach.',
      decidedBy: 'did:webvh:QmAdmin:dids.example:admin',
      decidedAt: '2026-09-27T08:58:30Z',
      disposition: 'tombstone',
      noticeId: 'urn:uuid:7a1f0c3e-2b4d-4e6f-8a9b-0c1d2e3f4a5b',
    })
    expect(emit).toHaveBeenCalledWith('vti:removed', {
      communityDid: COMMUNITY,
      reason: 'Repeated code-of-conduct breach.',
    })
  })

  it("is checked under the community's authentication key", async () => {
    const { st, membership: held } = store({ membership })
    const verify = jest.fn(async () => false)
    await expect(receiveCommunityNotice(agent, st, PERSONA, notice(), { now: NOW, verify })).resolves.toBe('ignored')
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ type: REMOVAL_NOTICE }), COMMUNITY)
    expect(held()?.removal).toBeUndefined()
  })

  it.each([
    ['from someone else than its issuer', notice({}, { issuer: 'did:webvh:QmOther:elsewhere' })],
    ['addressed to someone else', notice({}, { recipient: 'did:webvh:QmOther:p' })],
    ['about someone else', notice({ did: 'did:webvh:QmOther:p' })],
    ['older than 31 days', notice({}, { issuedAt: '2026-08-26T08:59:00Z' })],
    ['dated in the future', notice({}, { issuedAt: '2026-09-27T09:10:00Z' })],
    ['with an unknown code', notice({ code: 'kicked' })],
    ['with an unknown disposition', notice({ disposition: 'policydefault' })],
    ['decided before this membership began', notice({ decidedAt: '2026-09-19T10:00:00Z' })],
  ])('changes nothing when it is %s', async (_why, message) => {
    const { st, membership: held } = store({ membership })
    await expect(receiveCommunityNotice(agent, st, PERSONA, message, { now: NOW, verify: verified })).resolves.toBe(
      'ignored'
    )
    expect(held()?.removal).toBeUndefined()
  })

  it('changes nothing for a member already removed, or with no membership here', async () => {
    const removal = { ...notice().body.payload, noticeId: 'urn:uuid:earlier' } as never
    const already = store({ membership: { ...membership, removal } })
    await expect(
      receiveCommunityNotice(agent, already.st, PERSONA, notice(), { now: NOW, verify: verified })
    ).resolves.toBe('ignored')
    const none = store()
    await expect(
      receiveCommunityNotice(agent, none.st, PERSONA, notice(), { now: NOW, verify: verified })
    ).resolves.toBe('ignored')
  })
})

// An applied notice says so, or a removal that was stored reads exactly like one
// that was dropped (lab, 2026-09-29). Identifiers as prefixes only: the line
// reaches testers' problem reports.
describe('an applied notice', () => {
  it('is logged, naming the community by a DID prefix only', async () => {
    const info = jest.fn()
    const logged = { config: { logger: { warn: jest.fn(), info } } } as never
    const { st } = store({ membership })
    await expect(receiveCommunityNotice(logged, st, PERSONA, notice(), { now: NOW, verify: verified })).resolves.toBe(
      'removed'
    )
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^\[VTI\] applied a removal notice from did:webvh:QmCommunity:vt…/))
    expect(String(info.mock.calls[0][0])).not.toContain(COMMUNITY)
    expect(String(info.mock.calls[0][0])).not.toContain(PERSONA)
  })
})

describe("a community's join receipt", () => {
  const receipt = (payload: Record<string, unknown>, doc: Record<string, unknown> = {}) => ({
    type: SUBMIT_RECEIPT,
    from: COMMUNITY,
    body: {
      id: 'urn:uuid:1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b',
      type: SUBMIT_RECEIPT,
      threadId: 'urn:uuid:query',
      issuer: COMMUNITY,
      recipient: PERSONA,
      issuedAt: '2026-09-27T08:59:00Z',
      payload,
      ...doc,
    },
  })
  const open: JoinSubmission = {
    communityDid: COMMUNITY,
    personaDid: PERSONA,
    sentAt: '2026-09-27T08:50:00Z',
    withInvitation: false,
    via: 'join',
  }

  it('records the request id and that the community has it', async () => {
    const { st, submission } = store({ submission: open })
    await expect(
      receiveCommunityNotice(agent, st, PERSONA, receipt({ requestId: 'r-42', status: 'pending' }), {
        now: NOW,
        verify: verified,
      })
    ).resolves.toBe('acknowledged')
    expect(submission()).toMatchObject({ requestId: 'r-42', status: 'pending' })
    expect(submission()?.acknowledgedAt).toBeDefined()
  })

  it('changes nothing when older than a day, malformed, or for a join this phone did not send', async () => {
    const stale = store({ submission: open })
    await expect(
      receiveCommunityNotice(
        agent,
        stale.st,
        PERSONA,
        receipt({ requestId: 'r-42', status: 'pending' }, { issuedAt: '2026-09-26T08:00:00Z' }),
        { now: NOW, verify: verified }
      )
    ).resolves.toBe('ignored')
    const malformed = store({ submission: open })
    await expect(
      receiveCommunityNotice(agent, malformed.st, PERSONA, receipt({ status: 'pending' }), {
        now: NOW,
        verify: verified,
      })
    ).resolves.toBe('ignored')
    const none = store()
    await expect(
      receiveCommunityNotice(agent, none.st, PERSONA, receipt({ requestId: 'r-42', status: 'pending' }), {
        now: NOW,
        verify: verified,
      })
    ).resolves.toBe('ignored')
  })

  it('is not taken for any other message', async () => {
    const { st } = store({ submission: open })
    await expect(
      receiveCommunityNotice(agent, st, PERSONA, { type: 'https://trusttasks.org/spec/other/0.1', from: COMMUNITY })
    ).resolves.toBeUndefined()
  })
})

describe('the words a removed person reads', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  })
  beforeEach(() => communityTarget.clear())
  const t = i18n.t.bind(i18n)

  it('names the community and gives its reason, never a DID', () => {
    communityTarget.publishedName(COMMUNITY, 'Keyring Test Community')
    const words = removedWords(COMMUNITY, 'Repeated code-of-conduct breach.', t)
    expect(words).toBe(
      'Keyring Test Community removed you. You can ask to join again. The reason given: Repeated code-of-conduct breach.'
    )
    expect(words).not.toMatch(/did:/)
  })

  it('says only that, when the community gave no reason', () => {
    expect(removedWords(COMMUNITY, undefined, t)).toBe('A community removed you. You can ask to join again.')
  })
})
