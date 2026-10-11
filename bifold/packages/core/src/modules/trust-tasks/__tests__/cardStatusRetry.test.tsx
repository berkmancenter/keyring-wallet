/**
 * IN-258 (report X8YZ-X2FP): a community admitted a member and delivered the
 * membership card three times; each time the card's status list could not be
 * read (its host does not resolve, so fetch fails at once with "TypeError:
 * Network request failed"), and the card was dropped with a log line and
 * nothing else. The member read "not accepted", and a restart did not help.
 *
 * Now: the log names the host; the card is still not kept while its status
 * cannot be read (the check is not relaxed); the delivery is tried again on a
 * growing interval; and the community's card says so, with Try again.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import { gzip } from 'pako'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { testIdWithKey } from '../../../utils/testable'
import {
  CARD_STATUS_RETRY_DELAYS_MS,
  clearStatusChecks,
  holdForStatusCheck,
  pendingStatusCheck,
  retryStatusCheckNow,
  VTI_CARD_STATUS_PENDING_EVENT,
} from '../module/vtiCardStatusRetry'
import { checkDeliveredCard, VtiCardStatusUnreadable } from '../module/vtiDeliveredCheck'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
import { CardStatusNotice, CardStatusNoticeIds } from '../screens/cardStatusNotice'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  verifyDocumentProof: jest.fn(async () => true),
}))

const COMMUNITY = 'did:webvh:QmNvAiYMwoZMWG:webvh.example:test-vtc'
const PERSONA = 'did:webvh:Qmcvqtz24Nh2tD:dids.example:column-hobby'
const STATUS_URL = 'https://test-vtc.storm.ws/v1/status-lists/revocation'

const membership = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'urn:uuid:7d2f0c1e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
  type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
  issuer: COMMUNITY,
  validFrom: '2026-10-11T17:00:00Z',
  validUntil: '2026-11-11T17:00:00Z',
  credentialSubject: { id: PERSONA },
  credentialStatus: {
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: '9',
    statusListCredential: STATUS_URL,
  },
  proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofValue: 'z' },
}

const message = {
  id: 'urn:uuid:issue-1',
  type: CREDENTIAL_EXCHANGE_ISSUE,
  from: COMMUNITY,
  body: { credential_response: { credential: membership } },
}

/** A status list of `bits` clear bits, encoded as issuers write it (gzip, base64url, multibase 'u'). */
const emptyList = (bits: number): string => {
  let binary = ''
  for (const b of gzip(new Uint8Array(bits / 8))) binary += String.fromCharCode(b)
  return `u${globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** The report's fetch: the host does not resolve, so it fails at once. */
const unresolvable = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch

function store() {
  const saved: unknown[] = []
  return {
    saved,
    getMembership: async () => undefined,
    saveMembership: async (m: unknown) => void saved.push(m),
    saveHeldCredential: async (c: unknown) => void saved.push(c),
  }
}

/** The take the inbox runs, with the real delivered-card check and a fetch we choose. */
const take = (s: ReturnType<typeof store>, fetchImpl: () => typeof fetch) => () =>
  receiveIssue(s as never, PERSONA, message as never, {
    checkCard: (credential, issuer) => checkDeliveredCard({} as never, credential, issuer, { fetchImpl: fetchImpl() }),
  })

beforeEach(() => {
  jest.useFakeTimers()
  clearStatusChecks()
})
afterEach(() => {
  clearStatusChecks()
  jest.useRealTimers()
})

describe('a card whose status list cannot be read (IN-258)', () => {
  it('is not kept, and the error names the host, never the path', async () => {
    const s = store()
    const error = await take(s, () => unresolvable)().catch((e) => e)
    expect(error).toBeInstanceOf(VtiCardStatusUnreadable)
    expect(error.host).toBe('test-vtc.storm.ws')
    expect(error.message).toContain('could not be read at test-vtc.storm.ws')
    expect(error.message).toContain('TypeError: Network request failed')
    expect(error.message).not.toContain('/v1/status-lists')
    expect(s.saved).toEqual([])
  })

  it('is tried again on a growing interval, and kept only once its status reads', async () => {
    const s = store()
    let fetchImpl = unresolvable
    const retry = jest.fn(take(s, () => fetchImpl))
    const announced: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_CARD_STATUS_PENDING_EVENT, (e) => announced.push(e))

    holdForStatusCheck(`${COMMUNITY}|${message.id}`, { communityDid: COMMUNITY, host: 'test-vtc.storm.ws', retry })
    expect(pendingStatusCheck(COMMUNITY)).toMatchObject({ host: 'test-vtc.storm.ws', attempts: 0 })
    expect(announced).toContainEqual({ communityDid: COMMUNITY })

    // First wait, still unreachable: not kept, and the next wait is longer.
    await act(async () => {
      jest.advanceTimersByTime(CARD_STATUS_RETRY_DELAYS_MS[0])
    })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(s.saved).toEqual([])
    expect(pendingStatusCheck(COMMUNITY)).toMatchObject({ attempts: 1 })
    await act(async () => {
      jest.advanceTimersByTime(CARD_STATUS_RETRY_DELAYS_MS[0])
    })
    expect(retry).toHaveBeenCalledTimes(1)

    // The list becomes readable (it holds up, index 9 clear): the next try keeps it.
    fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          issuer: COMMUNITY,
          credentialSubject: {
            statusPurpose: 'revocation',
            encodedList: emptyList(1024),
          },
          proof: { type: 'DataIntegrityProof' },
        }),
    })) as unknown as typeof fetch
    await act(async () => {
      jest.advanceTimersByTime(CARD_STATUS_RETRY_DELAYS_MS[1])
    })
    expect(retry).toHaveBeenCalledTimes(2)
    expect(s.saved).toHaveLength(1)
    expect(pendingStatusCheck(COMMUNITY)).toBeUndefined()
    sub.remove()
  })

  it('a redelivery of the same message does not start a second schedule', async () => {
    const retry = jest.fn(async () => {
      throw new VtiCardStatusUnreadable('offline', 'test-vtc.storm.ws')
    })
    holdForStatusCheck('k', { communityDid: COMMUNITY, retry })
    holdForStatusCheck('k', { communityDid: COMMUNITY, retry })
    await act(async () => {
      jest.advanceTimersByTime(CARD_STATUS_RETRY_DELAYS_MS[0])
    })
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('stops trying when the card is refused for another reason', async () => {
    const retry = jest.fn(async () => {
      throw new Error('proof')
    })
    holdForStatusCheck('k', { communityDid: COMMUNITY, retry })
    await expect(retryStatusCheckNow(COMMUNITY)).resolves.toBe('failed')
    expect(pendingStatusCheck(COMMUNITY)).toBeUndefined()
  })
})

describe("the community's card while one waits", () => {
  const renderNotice = (onKept = jest.fn()) =>
    render(
      <BasicAppContext>
        <CardStatusNotice communityDid={COMMUNITY} onKept={onKept} />
      </BasicAppContext>
    )

  it('says nothing when no card waits', () => {
    const tree = renderNotice()
    expect(tree.queryByTestId(testIdWithKey(CardStatusNoticeIds.notice))).toBeNull()
  })

  it("says Keyring couldn't check the card, and Try again tries at once", async () => {
    const retry = jest.fn(async () => {
      throw new VtiCardStatusUnreadable('TypeError: Network request failed', 'test-vtc.storm.ws')
    })
    holdForStatusCheck('k', { communityDid: COMMUNITY, retry })
    const tree = renderNotice()
    expect(tree.getByTestId(testIdWithKey(CardStatusNoticeIds.text)).props.children).toBe(
      'Community.CardStatusUnchecked'
    )
    // In plain words, never of proofs or status lists' addresses.
    expect(en.Community.CardStatusUnchecked).toBe(
      "Keyring couldn't check this card's status, so it isn't kept yet. Keyring keeps trying."
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(CardStatusNoticeIds.tryAgain)))
    })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(testIdWithKey(CardStatusNoticeIds.still))).toBeTruthy()
  })

  it('goes away, and tells the screen, once the card is kept', async () => {
    const onKept = jest.fn()
    holdForStatusCheck('k', { communityDid: COMMUNITY, retry: async () => undefined })
    const tree = renderNotice(onKept)
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(CardStatusNoticeIds.tryAgain)))
    })
    expect(onKept).toHaveBeenCalled()
    expect(tree.queryByTestId(testIdWithKey(CardStatusNoticeIds.notice))).toBeNull()
  })
})
