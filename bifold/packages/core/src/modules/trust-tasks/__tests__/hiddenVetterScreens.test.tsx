/**
 * Vouching privately (Keyring↔Keyring hidden vetting, 243): a vetter's agent
 * enrols for the period, draws tokens on each tick (only while Keyring is
 * open, so the screen draws when one is due), and attests from a token after
 * a session. The vetter declares how they know the person, with no default;
 * the community learns that enough members vouched, never which.
 */
import { useAgent } from '@bifold/react-hooks'
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { HIDDEN_VETTING_EXT, type VtiCriterion } from '../module/joinManifest'
import { vtiAgent } from '../module/vtiAgent'
import {
  drawDue,
  registerHiddenVetter,
  type HiddenVetterSeam,
  type HiddenVetterStanding,
} from '../screens/hiddenVetterSeam'
import VtiHiddenVetter, { hiddenVetterErrorKey } from '../screens/VtiHiddenVetter'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const COMMUNITY = 'did:webvh:QmVtc:vtc.example:hv-community'
const criterion: VtiCriterion = {
  id: 'vetted-member',
  admission: 'automatic',
  vetting: {
    minStatements: 1,
    acceptedMethods: ['inPerson', 'video'],
    requiredClaims: ['name.legal'],
    ext: { [HIDDEN_VETTING_EXT]: { suite: 'ps-ddh-bls12381' } },
  },
}
const later = (ms: number) => new Date(Date.now() + ms).toISOString()
const enrolled: HiddenVetterStanding = {
  enrolled: true,
  period: 'vetter/2026-10',
  enrolledUntil: later(20 * 86400000),
  tokens: 2,
  lastDrawAt: later(-86400000),
  nextDrawAt: later(2 * 86400000),
}
const request = {
  id: 'req-1',
  applicantDid: 'did:webvh:QmA:dids.example:ada',
  applicantName: 'Ada',
  receivedAt: later(-3600000),
}
const pcsError = (code: string) => Object.assign(new Error(code), { code })

function fakeSeam(over: Partial<HiddenVetterSeam> = {}): jest.Mocked<HiddenVetterSeam> {
  return {
    standing: jest.fn(async () => enrolled),
    enrol: jest.fn(async () => undefined),
    drawTokens: jest.fn(async () => ({ drawn: 3 })),
    requests: jest.fn(async () => [request]),
    attest: jest.fn(async () => undefined),
    decline: jest.fn(async () => undefined),
    ...over,
  } as jest.Mocked<HiddenVetterSeam>
}

const open = async (seam?: HiddenVetterSeam) => {
  if (seam) registerHiddenVetter(seam)
  ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: COMMUNITY, criterionId: 'vetted-member' } })
  jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [criterion] } as never)
  const tree = render(
    <BasicAppContext>
      <VtiHiddenVetter />
    </BasicAppContext>
  )
  await act(async () => undefined)
  await act(async () => undefined)
  return tree
}
const press = async (tree: ReturnType<typeof render>, key: string) =>
  act(async () => fireEvent.press(tree.getByTestId(id(key))))

beforeEach(() => {
  ;(useAgent as jest.Mock).mockReturnValue({ agent: { config: { logger: { info: jest.fn() } } } })
})
afterEach(() => {
  registerHiddenVetter(undefined)
  jest.restoreAllMocks()
})

describe('vouching privately', () => {
  it('a build without it: says so, offers nothing', async () => {
    const tree = await open()
    expect(tree.getByTestId(id('HiddenVetterNotAvailable'))).toHaveTextContent('Vetting.Vouch.NotAvailable')
  })

  it('never enrolled (vetter/show:notFound): offers to enrol, not an error; enrolling draws the first tokens', async () => {
    let enrolledNow = false
    const seam = fakeSeam({
      standing: jest.fn(async () => {
        if (!enrolledNow) throw pcsError('vta/pcs/vetter/show:notFound')
        return { enrolled: true, tokens: 0 }
      }),
      enrol: jest.fn(async () => {
        enrolledNow = true
      }),
    })
    const tree = await open(seam)
    expect(tree.queryByTestId(id('HiddenVetterError'))).toBeNull()
    await press(tree, 'HiddenVetterEnrol')
    expect(seam.enrol).toHaveBeenCalledWith(expect.anything(), COMMUNITY, criterion)
    expect(seam.drawTokens).toHaveBeenCalled()
  })

  it('enrolled: how many people they can vouch for, the next draw, and to keep opening Keyring', async () => {
    const seam = fakeSeam()
    const tree = await open(seam)
    expect(tree.getByTestId(id('HiddenVetterTokens'))).toHaveTextContent(/Vetting\.Vouch\.Tokens/)
    expect(tree.getByTestId(id('HiddenVetterNextDraw'))).toHaveTextContent(/Vetting\.Vouch\.NextDraw/)
    expect(tree.getByText('Vetting.Vouch.KeepOpening')).toBeTruthy()
    // Not due yet: nothing drawn on its own.
    expect(seam.drawTokens).not.toHaveBeenCalled()
  })

  it('a new or restored phone (next draw unknown): nothing drawn on its own, and no next-draw date', async () => {
    const seam = fakeSeam({ standing: jest.fn(async () => ({ enrolled: true, tokens: 0 })) })
    const tree = await open(seam)
    expect(seam.drawTokens).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('HiddenVetterNextDraw'))).toBeNull()
    // None left: the person may draw.
    expect(tree.getByTestId(id('HiddenVetterDraw'))).toBeTruthy()
  })

  it('a draw that is due is made when the screen opens', async () => {
    const seam = fakeSeam({ standing: jest.fn(async () => ({ ...enrolled, nextDrawAt: later(-1000) })) })
    await open(seam)
    expect(seam.drawTokens).toHaveBeenCalledTimes(1)
  })

  it('nobody waiting: says so', async () => {
    const tree = await open(fakeSeam({ requests: jest.fn(async () => []) }))
    expect(tree.getByTestId(id('HiddenVetterNoRequests'))).toBeTruthy()
  })

  it('vouching asks how they met, what they checked and that it was live; how they know them is not asked', async () => {
    const seam = fakeSeam()
    const tree = await open(seam)
    expect(tree.getByTestId(id('HiddenVetterRequest_req-1'))).toHaveTextContent(/Ada/)
    await press(tree, 'HiddenVetterVouch_req-1')
    const confirm = () => tree.getByTestId(id('HiddenVetterConfirm_req-1'))
    expect(confirm()).toBeDisabled()
    await press(tree, 'HiddenVetterMethod_inPerson')
    await press(tree, 'HiddenVetterClaims')
    await press(tree, 'HiddenVetterLive')
    expect(tree.queryByTestId(id('HiddenVetterRelationship_none'))).toBeNull()
    expect(confirm()).not.toBeDisabled()
    await press(tree, 'HiddenVetterConfirm_req-1')
    // `none`, as the named flow sends and openvtc's form defaults to.
    expect(seam.attest).toHaveBeenCalledWith(expect.anything(), 'req-1', {
      method: 'inPerson',
      claimsVerified: ['name.legal'],
      livenessConfirmed: true,
      declaredRelationship: 'none',
    })
    expect(tree.getByTestId(id('HiddenVetterDone_req-1'))).toHaveTextContent('Vetting.Vouch.Done')
  })

  it('nothing left to vouch with: says until when, and does not attest', async () => {
    const seam = fakeSeam({ standing: jest.fn(async () => ({ ...enrolled, tokens: 0 })) })
    const tree = await open(seam)
    await press(tree, 'HiddenVetterVouch_req-1')
    for (const key of ['HiddenVetterMethod_video', 'HiddenVetterClaims', 'HiddenVetterLive']) {
      await press(tree, key)
    }
    expect(tree.getByText(/Vetting\.Vouch\.NoTokensUntil/)).toBeTruthy()
    expect(tree.getByTestId(id('HiddenVetterConfirm_req-1'))).toBeDisabled()
  })

  it('offers only the ways the criterion accepts', async () => {
    const tree = await open(fakeSeam())
    await press(tree, 'HiddenVetterVouch_req-1')
    expect(tree.getByTestId(id('HiddenVetterMethod_inPerson'))).toBeTruthy()
    expect(tree.getByTestId(id('HiddenVetterMethod_video'))).toBeTruthy()
    expect(tree.queryByTestId(id('HiddenVetterMethod_priorAcquaintance'))).toBeNull()
  })

  it('declining goes to the request', async () => {
    const seam = fakeSeam()
    const tree = await open(seam)
    await press(tree, 'HiddenVetterDecline_req-1')
    expect(seam.decline).toHaveBeenCalledWith(expect.anything(), 'req-1')
  })
})

describe('when a draw is due', () => {
  it.each([
    [{ enrolled: false, tokens: 0 }, false],
    // A new or restored phone: no last draw, so the next is unknown, not due.
    [{ enrolled: true, tokens: 0 }, false],
    [{ enrolled: true, tokens: 1, lastDrawAt: later(-1000), nextDrawAt: later(60000) }, false],
    [{ enrolled: true, tokens: 1, lastDrawAt: later(-1000), nextDrawAt: later(-1000) }, true],
  ])('%j → %s', (standing, due) => {
    expect(drawDue(standing, Date.now())).toBe(due)
  })
})

describe('the agent’s codes, in words', () => {
  it.each([
    ['vta/pcs/attest:noToken', 'Vetting.Vouch.NoTokensError'],
    ['vta/pcs/attest:notEnrolled', 'Vetting.Vouch.NotEnrolledError'],
    ['vta/pcs/root-request:labelNotLive', 'Vetting.Vouch.PeriodClosed'],
    ['vta/pcs/tokens/request:labelNotLive', 'Vetting.Vouch.PeriodClosed'],
    ['vta/pcs/tokens/request:alreadyInFlight', 'Vetting.Vouch.DrawBusy'],
    ['vta/pcs/tokens/accept:noDrawInFlight', 'Vetting.Vouch.DrawBusy'],
    ['vta/pcs/tokens/request:countExceedsDrip', 'Vetting.Vouch.DrawBusy'],
    ['keyring/hidden-vetter/attest:notImplemented', 'Vetting.Hidden.NotInThisBuild'],
    ['vta/pcs/attest:parametersInvalid', 'Vetting.Vouch.ErrorGeneric'],
    [undefined, 'Vetting.Vouch.ErrorGeneric'],
  ])('%s → %s', (code, key) => {
    expect(hiddenVetterErrorKey(code)).toBe(key)
  })
})
