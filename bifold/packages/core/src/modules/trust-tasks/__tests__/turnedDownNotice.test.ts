/**
 * "X turned down your request": a community does not push a refusal, so the
 * app learns it when it asks for the request's status. Said once per request,
 * the first time a stored request reads as turned down — never again on a
 * later read, and never for a refusal that was the answer to the person's own
 * submit, which they saw on screen.
 */
import { renderHook } from '@testing-library/react-native'
import i18n from 'i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { recordAnswer, recordSent, recordStatus, VTI_TURNED_DOWN_EVENT } from '../module/joinSubmission'
import type { JoinSubmission, VtiCommunityStore } from '../module/VtiCommunityStore'
import { communityTarget } from '../module/vtiCommunityLink'
import { readJoinState } from '../module/vtiJoin'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'
import { turnedDownWords, useVtiTurnedDownNotice } from '../screens/turnedDownNotice'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:QmTurned:vtc.example:keyring-test-vtc'
const PERSONA = 'did:webvh:QmPersona:vta.example:p'
const NOW = new Date('2026-10-03T09:00:00Z')

function memoryStore(submission?: JoinSubmission) {
  let held = submission
  const store = {
    getMembership: jest.fn(async () => undefined),
    getDeparture: jest.fn(async () => undefined),
    getSubmission: jest.fn(async () => held),
    saveSubmission: jest.fn(async (s: JoinSubmission) => void (held = s)),
  }
  return { store: store as unknown as VtiCommunityStore, current: () => held }
}

// Each case sends at its own time: a request is said once per launch as well
// as once per stored mark, and the launch's memory is keyed by when it was sent.
let sentCount = 0
const pending = (extra: Partial<JoinSubmission> = {}): JoinSubmission => ({
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  sentAt: `2026-10-03T08:${String(sentCount++).padStart(2, '0')}:00Z`,
  acknowledgedAt: '2026-10-03T08:59:00Z',
  status: 'pending',
  withInvitation: false,
  via: 'join',
  ...extra,
})

describe('when a turned-down request is news', () => {
  let heard: Array<{ communityDid?: string; reason?: string }>
  let sub: { remove: () => void }
  beforeEach(() => {
    heard = []
    sub = DeviceEventEmitter.addListener(VTI_TURNED_DOWN_EVENT, (e) => heard.push(e))
  })
  afterEach(() => sub.remove())

  it('an open request first read as rejected: said once, with its reason, and marked as said', async () => {
    const { store, current } = memoryStore(pending())
    await recordStatus(store, COMMUNITY, { status: 'rejected', code: 'policy:denied', reason: 'Not this season' }, NOW)
    expect(heard).toEqual([{ communityDid: COMMUNITY, reason: 'Not this season' }])
    expect(current()).toMatchObject({ status: 'rejected', rejectionSaidAt: NOW.toISOString() })
  })

  it('read again later: not said a second time', async () => {
    const { store, current } = memoryStore(pending())
    await recordStatus(store, COMMUNITY, { status: 'rejected' }, NOW)
    await recordStatus(store, COMMUNITY, { status: 'rejected' }, new Date('2026-10-04T09:00:00Z'))
    expect(heard).toHaveLength(1)
    expect(current()?.rejectionSaidAt).toBe(NOW.toISOString())
  })

  it('two screens asking at the same moment: said once', async () => {
    const { store } = memoryStore(pending())
    await Promise.all([
      recordStatus(store, COMMUNITY, { status: 'rejected' }, NOW),
      recordStatus(store, COMMUNITY, { status: 'rejected' }, NOW),
    ])
    expect(heard).toHaveLength(1)
  })

  it('marked as said on an earlier launch: not said again', async () => {
    const { store } = memoryStore(pending({ rejectionSaidAt: '2026-10-02T00:00:00Z' }))
    await recordStatus(store, COMMUNITY, { status: 'rejected' }, NOW)
    expect(heard).toEqual([])
  })

  it('the answer to the person’s own submit: they saw it, so it is not said', async () => {
    const { store } = memoryStore(pending({ acknowledgedAt: undefined, status: undefined }))
    await recordAnswer(store, COMMUNITY, { verdict: { requestId: 'r1', effect: 'deny' } }, NOW)
    await recordStatus(store, COMMUNITY, { requestId: 'r1', status: 'rejected' }, NOW)
    expect(heard).toEqual([])
  })

  it('a new request after a refusal starts unmarked, and its own refusal is said', async () => {
    const { store, current } = memoryStore(pending())
    await recordStatus(store, COMMUNITY, { status: 'rejected' }, NOW)
    await recordSent(
      store,
      { communityDid: COMMUNITY, personaDid: PERSONA, withInvitation: false, via: 'join' },
      new Date('2026-10-05T09:00:00Z')
    )
    expect(current()?.rejectionSaidAt).toBeUndefined()
    await recordStatus(store, COMMUNITY, { status: 'pending' }, new Date('2026-10-05T09:01:00Z'))
    await recordStatus(store, COMMUNITY, { status: 'rejected' }, new Date('2026-10-06T09:00:00Z'))
    expect(heard).toHaveLength(2)
  })

  it('a request still pending, deferred or approved: nothing said', async () => {
    const { store, current } = memoryStore(pending())
    await recordStatus(store, COMMUNITY, { status: 'pending' }, NOW)
    await recordStatus(store, COMMUNITY, { status: 'deferred', needs: ['vetting:statements:1'] }, NOW)
    await recordStatus(store, COMMUNITY, { status: 'approved' }, NOW)
    expect(heard).toEqual([])
    expect(current()?.rejectionSaidAt).toBeUndefined()
  })

  it('learned through the join state a screen reads, as the Join screen and the cards do', async () => {
    const { store } = memoryStore(pending({ requestId: 'r9' }))
    const state = await readJoinState({} as never, COMMUNITY, {
      communityStore: store,
      status: async () => ({ requestId: 'r9', status: 'rejected', reason: 'Full for now' }),
    })
    expect(state).toMatchObject({ kind: 'rejected', reason: 'Full for now' })
    expect(heard).toEqual([{ communityDid: COMMUNITY, reason: 'Full for now' }])
  })
})

describe('the words', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  })
  beforeEach(() => communityTarget.clear())
  const t = i18n.t.bind(i18n)

  it('name the community by the name it published, with its reason when it gave one', () => {
    communityTarget.publishedName(COMMUNITY, 'Keyring Lab Community')
    expect(turnedDownWords(COMMUNITY, 'Not this season', t)).toBe(
      'Your request was turned down by Keyring Lab Community. The reason given: Not this season'
    )
    expect(turnedDownWords(COMMUNITY, undefined, t)).toBe('Your request was turned down by Keyring Lab Community.')
  })

  it('never by its DID or host when no name is known', () => {
    const words = turnedDownWords(COMMUNITY, undefined, t)
    expect(words).not.toMatch(/did:|vtc\.example/)
    expect(words).toBe('Your request was turned down by keyring-test-vtc (no name published yet).')
  })

  it('exist in every language', () => {
    for (const words of [en, fr, ptBr]) {
      expect((words.Join as Record<string, unknown>).StandingRejected).toMatch(/\{\{community\}\}/)
    }
  })
})

describe('the pop-up', () => {
  it('shows the words at the bottom when the event comes, and stops listening when gone', () => {
    const show = jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
    const { unmount } = renderHook(() => useVtiTurnedDownNotice())
    DeviceEventEmitter.emit(VTI_TURNED_DOWN_EVENT, { communityDid: COMMUNITY })
    expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0]).toMatchObject({ type: 'warn', position: 'bottom', text1: expect.any(String) })
    expect((show.mock.calls[0][0] as { bottomOffset?: number }).bottomOffset).toBeGreaterThanOrEqual(TAB_BAR_CLEARANCE)
    unmount()
    DeviceEventEmitter.emit(VTI_TURNED_DOWN_EVENT, { communityDid: COMMUNITY })
    expect(show).toHaveBeenCalledTimes(1)
    show.mockRestore()
  })
})
