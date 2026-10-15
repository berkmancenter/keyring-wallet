/**
 * Private (hidden) vetting, on the screens (242): Join offers a private way
 * only in a build that carries it, and asks the person's agent whether it can
 * do it only when they tap — asking may push a consent request to an
 * approver's phone. Its own screen shows how many attestations the agent has
 * verified, never who gave them, and sends in three said steps.
 */
import { useAgent } from '@bifold/react-hooks'
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { HIDDEN_VETTING_EXT, type JoinAsks, type JoinWay, type VtiCriterion } from '../module/joinManifest'
import { vtiAgent } from '../module/vtiAgent'
import {
  pcsErrorCode,
  registerHiddenVetting,
  type HiddenVettingRecord,
  type HiddenVettingSeam,
} from '../screens/hiddenVettingSeam'
import { joinCard } from '../screens/joinWays'
import { PrivateVettingStart } from '../screens/PrivateVettingStart'
import VtiHiddenVetting, { hiddenVettingErrorKey } from '../screens/VtiHiddenVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const COMMUNITY = 'did:webvh:QmVtc:vtc.example:test-vtc'
const criterion: VtiCriterion = {
  id: 'hidden-member',
  admission: 'automatic',
  requirementsDigest: 'zDigestNow',
  vetting: {
    minStatements: 2,
    ext: { [HIDDEN_VETTING_EXT]: { suite: 'ps-ddh-bls12381' } },
    extCritical: [HIDDEN_VETTING_EXT],
  },
}
const record: HiddenVettingRecord = {
  applicationId: 'app-1',
  communityDid: COMMUNITY,
  criterionId: 'hidden-member',
  requirementsDigest: 'zDigestNow',
  createdAt: '2026-10-14T12:00:00Z',
}
const pcsError = (code: string) => Object.assign(new Error(code), { code })

function fakeSeam(over: Partial<HiddenVettingSeam> = {}): jest.Mocked<HiddenVettingSeam> {
  return {
    check: jest.fn(async () => ({ ok: true as const })),
    record: jest.fn(async () => record),
    createApplication: jest.fn(async () => record),
    progress: jest.fn(async (_a, _r, needed: number) => ({ needed, verified: 0, attestations: [] })),
    requestVetting: jest.fn(async () => undefined),
    fetchChallenge: jest.fn(async () => ({ challenge: 'c-1' })),
    prove: jest.fn(async () => ({ proof: 'p' })),
    submitJoin: jest.fn(async () => ({ effect: 'refer' })),
    deleteApplication: jest.fn(async () => undefined),
    ...over,
  } as jest.Mocked<HiddenVettingSeam>
}

const privateWay: JoinWay = {
  id: 'hidden-member',
  admission: 'automatic',
  requires: { invitation: false, vetting: { statements: 2, claims: [], methods: [] } },
  requiresNothing: false,
  usable: false,
  unusableBecause: 'vettingPrivate',
  hiddenVetting: { suite: 'ps-ddh-bls12381' },
  meets: 'no',
  digest: 'zDigestNow',
}
const offer = (ways: JoinWay[]): JoinAsks => ({ wire: '0.3', accepting: true, ways })

beforeEach(() => {
  ;(useAgent as jest.Mock).mockReturnValue({ agent: { config: { logger: { info: jest.fn() } } } })
})
afterEach(() => {
  registerHiddenVetting(undefined)
  jest.restoreAllMocks()
})

describe('Join: a private way', () => {
  it('in a build without hidden vetting: fails closed, as #405', () => {
    expect(joinCard(offer([privateWay]))).toMatchObject({ vettingNotSupported: 'private', noneUsable: true })
  })

  it('in a build that carries it: offered with its own button, nothing said unsupported', () => {
    const card = joinCard(offer([privateWay]), {}, { privateVettingAvailable: true })
    if (card.mode !== 'ways') throw new Error('expected ways')
    expect(card.vettingNotSupported).toBeUndefined()
    expect(card.rows[0]).toMatchObject({ privateVetting: true, cannotUse: false, canStartVetting: false })
    expect(card.button).toBe('none')
  })

  it('a suite agents cannot run still fails closed, with no tap', () => {
    const other = { ...privateWay, hiddenVetting: { suite: 'some-other-suite' } }
    const card = joinCard(offer([other]), {}, { privateVettingAvailable: true })
    expect(card).toMatchObject({ vettingNotSupported: 'private' })
  })

  it('at manifest 0.2, never offered', () => {
    expect(joinCard({ ...offer([privateWay]), wire: '0.2' }, {}, { privateVettingAvailable: true })).toEqual({
      mode: 'vettingNotSupported',
      vetting: 'private',
    })
  })
})

describe('Join: asking the agent, only on the tap', () => {
  const show = (onReady = jest.fn()) =>
    render(
      <BasicAppContext>
        <PrivateVettingStart criterion={criterion} community="Test VTC" rowId="hidden-member" onReady={onReady} />
      </BasicAppContext>
    )

  it('nothing is asked while it draws; the tap asks, and "yes" goes on', async () => {
    const seam = fakeSeam()
    registerHiddenVetting(seam)
    const onReady = jest.fn()
    const tree = show(onReady)
    expect(seam.check).not.toHaveBeenCalled()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinPrivateVettingStart_hidden-member'))))
    expect(seam.check).toHaveBeenCalledWith(expect.anything(), criterion)
    expect(onReady).toHaveBeenCalled()
  })

  it.each([
    ['noAgent', 'Join.Ways.PrivateVettingNoAgent'],
    ['agentTooOld', 'Join.Ways.PrivateVettingAgentTooOld'],
    ['phoneNotAllowed', 'Join.Ways.PrivateVettingPhoneNotAllowed'],
    ['suiteUnsupported', 'Join.Ways.PrivateVetting'],
    ['cannotTell', 'Join.Ways.PrivateVettingCannotTell'],
  ] as const)('%s: says so, and does not go on', async (reason, words) => {
    registerHiddenVetting(fakeSeam({ check: jest.fn(async () => ({ ok: false as const, reason })) }))
    const onReady = jest.fn()
    const tree = show(onReady)
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinPrivateVettingStart_hidden-member'))))
    expect(tree.getByTestId(id('JoinPrivateVettingRefused_hidden-member'))).toHaveTextContent(words)
    expect(onReady).not.toHaveBeenCalled()
  })

  it('an agent that could not be asked is said as that, never guessed as too old', async () => {
    registerHiddenVetting(
      fakeSeam({
        check: jest.fn(async () => {
          throw new Error('no answer')
        }),
      })
    )
    const tree = show()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinPrivateVettingStart_hidden-member'))))
    expect(tree.getByTestId(id('JoinPrivateVettingRefused_hidden-member'))).toHaveTextContent(
      'Join.Ways.PrivateVettingCannotTell'
    )
  })
})

describe('the private vetting screen', () => {
  const open = async (seam?: HiddenVettingSeam) => {
    if (seam) registerHiddenVetting(seam)
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: COMMUNITY, criterionId: 'hidden-member' } })
    jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [criterion] } as never)
    const tree = render(
      <BasicAppContext>
        <VtiHiddenVetting />
      </BasicAppContext>
    )
    await act(async () => undefined)
    return tree
  }
  const press = async (tree: ReturnType<typeof render>, key: string) =>
    act(async () => fireEvent.press(tree.getByTestId(id(key))))

  it('a build without it: fails closed', async () => {
    const tree = await open()
    expect(tree.getByTestId(id('HiddenVettingNotAvailable'))).toHaveTextContent('Join.Ways.PrivateVetting')
  })

  it('no application yet: Start makes one, then shows how far it has got', async () => {
    const seam = fakeSeam({ record: jest.fn(async () => undefined) })
    const tree = await open(seam)
    await press(tree, 'HiddenVettingStart')
    expect(seam.createApplication).toHaveBeenCalledWith(expect.anything(), COMMUNITY, criterion)
    expect(tree.getByTestId(id('HiddenVettingProgress'))).toBeTruthy()
  })

  it('progress counts attestations against the threshold, and names no vetter', async () => {
    const seam = fakeSeam({
      progress: jest.fn(async () => ({
        needed: 2,
        verified: 1,
        attestations: [{ tokenLabel: 'token/2026-10', validFrom: '2026-10-10T00:00:00Z' }],
      })),
    })
    const tree = await open(seam)
    expect(seam.progress).toHaveBeenCalledWith(expect.anything(), record, 2)
    expect(tree.getByTestId(id('HiddenVettingProgress'))).toHaveTextContent(/Vetting\.Hidden\.Progress/)
    expect(tree.getByTestId(id('HiddenVettingNeedMore'))).toHaveTextContent(/Vetting\.Hidden\.NeedMore/)
    expect(tree.queryByText(/token\/2026-10/)).toBeNull()
  })

  it('asks a vetter from a pasted ticket', async () => {
    const seam = fakeSeam()
    const tree = await open(seam)
    fireEvent.changeText(tree.getByTestId(id('HiddenVettingTicketInput')), '  https://ticket.example/t  ')
    await press(tree, 'HiddenVettingAskVetter')
    expect(seam.requestVetting).toHaveBeenCalledWith(expect.anything(), record, { link: 'https://ticket.example/t' })
    expect(tree.getByTestId(id('HiddenVettingAsked'))).toBeTruthy()
  })

  it('sends in three steps; admitted, the application leaves the agent', async () => {
    const seam = fakeSeam({ submitJoin: jest.fn(async () => ({ effect: 'allow' })) })
    const tree = await open(seam)
    await press(tree, 'HiddenVettingSend')
    expect(seam.fetchChallenge).toHaveBeenCalled()
    expect(seam.prove).toHaveBeenCalledWith(expect.anything(), record, criterion, 'c-1')
    expect(seam.submitJoin).toHaveBeenCalledWith(expect.anything(), record, criterion, { proof: 'p' })
    expect(tree.getByTestId(id('HiddenVettingResult'))).toHaveTextContent(/Vetting\.Hidden\.Admitted/)
    expect(seam.deleteApplication).toHaveBeenCalledWith(expect.anything(), record)
  })

  it('not enough vetters yet: said on the proof, and nothing is sent to the community', async () => {
    const seam = fakeSeam({
      prove: jest.fn(async () => {
        throw pcsError('vta/pcs/prove:noUsableAttestation')
      }),
    })
    const tree = await open(seam)
    await press(tree, 'HiddenVettingSend')
    expect(tree.getByTestId(id('HiddenVettingError'))).toHaveTextContent('Vetting.Hidden.NotEnoughYet')
    expect(seam.submitJoin).not.toHaveBeenCalled()
    expect(seam.deleteApplication).not.toHaveBeenCalled()
  })

  it('a challenge that lapsed while the agent proved: by its time, one fresh challenge and one more proof', async () => {
    const seam = fakeSeam({
      fetchChallenge: jest
        .fn()
        .mockResolvedValueOnce({ challenge: 'c-1', expiresAt: new Date(Date.now() - 1000).toISOString() })
        .mockResolvedValueOnce({ challenge: 'c-2', expiresAt: new Date(Date.now() + 60000).toISOString() }),
    })
    const tree = await open(seam)
    await press(tree, 'HiddenVettingSend')
    expect(seam.fetchChallenge).toHaveBeenCalledTimes(2)
    expect(seam.prove).toHaveBeenLastCalledWith(expect.anything(), record, criterion, 'c-2')
    expect(seam.submitJoin).toHaveBeenCalledTimes(1)
  })

  it('the community did not count the proof (no-proof): once more, a fresh challenge and proof, never the same proof', async () => {
    const seam = fakeSeam({
      fetchChallenge: jest.fn().mockResolvedValueOnce({ challenge: 'c-1' }).mockResolvedValueOnce({ challenge: 'c-2' }),
      prove: jest.fn().mockResolvedValueOnce({ proof: 'p1' }).mockResolvedValueOnce({ proof: 'p2' }),
      submitJoin: jest
        .fn()
        .mockResolvedValueOnce({ effect: 'deny', needs: ['vetting:hidden:no-proof'] })
        .mockResolvedValueOnce({ effect: 'refer' }),
    })
    const tree = await open(seam)
    await press(tree, 'HiddenVettingSend')
    expect(seam.submitJoin).toHaveBeenCalledTimes(2)
    expect(seam.submitJoin).toHaveBeenLastCalledWith(expect.anything(), record, criterion, { proof: 'p2' })
    expect(tree.getByTestId(id('HiddenVettingResult'))).toHaveTextContent('Vetting.Hidden.Sent')
  })

  it('a community that changed its way in since: says so, and starts afresh rather than proving', async () => {
    const seam = fakeSeam({ record: jest.fn(async () => ({ ...record, requirementsDigest: 'zDigestBefore' })) })
    const tree = await open(seam)
    expect(tree.getByTestId(id('HiddenVettingChanged'))).toHaveTextContent(/Vetting\.Hidden\.Changed/)
    expect(tree.queryByTestId(id('HiddenVettingSend'))).toBeNull()
    await press(tree, 'HiddenVettingStartAgain')
    expect(seam.deleteApplication).toHaveBeenCalled()
  })

  it('stopping takes the application off the agent', async () => {
    const seam = fakeSeam()
    const tree = await open(seam)
    await press(tree, 'HiddenVettingWithdraw')
    expect(seam.deleteApplication).toHaveBeenCalledWith(expect.anything(), record)
  })
})

describe('error codes, in words', () => {
  it.each([
    ['vta/pcs/prove:noUsableAttestation', 'Vetting.Hidden.NotEnoughYet'],
    ['vta/pcs/prove:notFound', 'Vetting.Hidden.ApplicationGone'],
    ['vta/pcs/verify-attestation:notFound', 'Vetting.Hidden.ApplicationGone'],
    ['vta/pcs/verify-attestation:attestationInvalid', 'Vetting.Hidden.AttestationRefused'],
    ['vta/pcs/prove:parametersInvalid', 'Vetting.Hidden.ErrorGeneric'],
    ['keyring/hidden-vetting/fetchChallenge:notImplemented', 'Vetting.Hidden.NotInThisBuild'],
    ['vta/pcs/prove:unsupportedSuite', 'Join.Ways.PrivateVetting'],
    [undefined, 'Vetting.Hidden.ErrorGeneric'],
  ])('%s → %s', (code, key) => {
    expect(hiddenVettingErrorKey(code)).toBe(key)
  })
})

describe('reading the code, wherever the module carries it', () => {
  it.each([
    [{ code: 'vta/pcs/prove:notFound' }],
    [{ payload: { code: 'vta/pcs/prove:notFound' } }],
    [{ document: { payload: { code: 'vta/pcs/prove:notFound' } } }],
  ])('%j', (error) => {
    expect(pcsErrorCode(error)).toBe('vta/pcs/prove:notFound')
  })

  it('a count alone is progress enough: no list, no crash', async () => {
    registerHiddenVetting(fakeSeam({ progress: jest.fn(async () => ({ needed: 2, verified: 1 })) }))
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: COMMUNITY, criterionId: 'hidden-member' } })
    jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [criterion] } as never)
    const tree = render(
      <BasicAppContext>
        <VtiHiddenVetting />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(tree.getByTestId(id('HiddenVettingProgress'))).toBeTruthy()
  })
})
