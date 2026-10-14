/**
 * The one-scan agent setup screen (`vta-claim`): confirm who the code is from
 * (nothing sent), the owner's confirmation, the six characters to compare, the
 * wait, and how it ends — against fake steps, so no protocol runs here.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { VtaClaimError, type ClaimedVta, type RedeemState } from '../module/vtaClaim'
import type { VtaClaimSteps } from '../module/vtaClaimSteps'
import { claimedDomainPath, VtaClaimFlow } from '../screens/VtaClaim'
import { VtaClaimIds } from '../screens/VtaClaim.ids'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const FARM = 'did:webvh:QmFarmScid:farm.example.com'
const LINK = `https://link.trustoverip.org/t#_from=${FARM}&_id=q3Vt7mXo9LwA2bR5cJ8kNg&_exp=${
  Math.floor(Date.now() / 1000) + 600
}&_type=/vti/flow/vta-claim/0.1`
const claimed: ClaimedVta = {
  farmDid: FARM,
  handle: 'q3Vt7mXo9LwA2bR5cJ8kNg',
  url: 'https://farm.example.com/trust-tasks',
  threadId: 'urn:uuid:t',
  walletDid: 'did:key:z6MkExampleClaimantKey',
  claimCheck: 'T5WZ42',
  farmDocument: {},
}

const fakeSteps = (over: Partial<VtaClaimSteps> = {}): jest.Mocked<VtaClaimSteps> =>
  ({
    canOwn: jest.fn(async () => true),
    confirmOwner: jest.fn(async () => ({ ok: true })),
    claim: jest.fn(async () => claimed),
    redeem: jest.fn(async () => ({
      vtaDid: 'did:webvh:QmNew:dids.example.com:vta',
      operation: 'provisionVta' as const,
    })),
    finish: jest.fn(async () => ({ kind: 'linked' as const, vtaDid: 'did:webvh:QmNew:dids.example.com:vta' })),
    ...over,
  }) as jest.Mocked<VtaClaimSteps>

const onClose = jest.fn()
const show = async (steps: VtaClaimSteps, link: string | undefined = LINK) => {
  const tree = render(
    <BasicAppContext>
      <VtaClaimFlow link={link} steps={steps} onClose={onClose} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
const press = async (tree: ReturnType<typeof render>, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

beforeEach(() => onClose.mockReset())

describe('the one-scan agent setup', () => {
  it('names the host by its DID’s host and sends nothing before Continue', async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    expect(tree.getByTestId(id(VtaClaimIds.confirm))).toBeTruthy()
    expect(tree.getByTestId(id(VtaClaimIds.host))).toHaveTextContent('farm.example.com')
    expect(steps.claim).not.toHaveBeenCalled()
    expect(steps.confirmOwner).not.toHaveBeenCalled()
  })

  // VTI-LNK-050: before anything is resolved, who the code says it is from —
  // the domain and the path — marked unverified (VTI-LNK-111: nothing resolved).
  it('shows the domain and path the code claims, marked unverified, before anything is resolved', async () => {
    const pathed = LINK.replace(FARM, `${FARM}:farm-auth`)
    const steps = fakeSteps()
    const tree = await show(steps, pathed)
    expect(tree.getByTestId(id(VtaClaimIds.host))).toHaveTextContent('farm.example.com/farm-auth')
    expect(tree.getByTestId(id(VtaClaimIds.unverified))).toHaveTextContent('VtaClaim.Unverified')
    expect(steps.claim).not.toHaveBeenCalled()
    expect(steps.canOwn).not.toHaveBeenCalled()
  })

  it('confirms the owner, claims, shows the code, and ends with the agent ready', async () => {
    let release: () => void = () => undefined
    let tell: (s: RedeemState) => void = () => undefined
    const steps = fakeSteps({
      redeem: jest.fn(
        (_c, options) =>
          new Promise((resolve) => {
            tell = options.onState
            release = () => resolve({ vtaDid: 'did:webvh:QmNew:dids.example.com:vta', operation: 'provisionVta' })
          })
      ),
    })
    const tree = await show(steps)
    await press(tree, VtaClaimIds.continue)
    expect(steps.confirmOwner).toHaveBeenCalledWith('VtaClaim.ConfirmReason')
    expect(steps.claim).toHaveBeenCalledWith(expect.objectContaining({ from: FARM, id: 'q3Vt7mXo9LwA2bR5cJ8kNg' }))
    expect(tree.getByTestId(id(VtaClaimIds.codeValue))).toHaveTextContent('T5WZ42')
    expect(tree.getByTestId(id(VtaClaimIds.codeStatus))).toHaveTextContent('VtaClaim.WaitingConfirm')
    await act(async () => tell({ state: 'provisioning' }))
    expect(tree.getByTestId(id(VtaClaimIds.codeStatus))).toHaveTextContent('VtaClaim.Provisioning')
    await act(async () => release())
    expect(steps.finish).toHaveBeenCalled()
    expect(tree.getByTestId(id(VtaClaimIds.ready))).toBeTruthy()
    await press(tree, VtaClaimIds.done)
    expect(onClose).toHaveBeenCalled()
  })

  it('a cancelled owner check stays on confirm and sends nothing', async () => {
    const steps = fakeSteps({ confirmOwner: jest.fn(async () => ({ ok: false, reason: 'cancelled' as const })) })
    const tree = await show(steps)
    await press(tree, VtaClaimIds.continue)
    expect(tree.getByTestId(id(VtaClaimIds.confirm))).toBeTruthy()
    expect(tree.queryByTestId(id(VtaClaimIds.confirmError))).toBeNull()
    expect(steps.claim).not.toHaveBeenCalled()
  })

  it('a phone that cannot own an agent is told why, before anything is sent', async () => {
    const steps = fakeSteps({ canOwn: jest.fn(async () => false) })
    const tree = await show(steps)
    await press(tree, VtaClaimIds.continue)
    expect(tree.getByTestId(id(VtaClaimIds.resultMessage))).toHaveTextContent('VtaClaim.Failure.cannotOwn')
    expect(steps.claim).not.toHaveBeenCalled()
  })

  it.each(['alreadyClaimed', 'rejected', 'handleExpired', 'unreachable', 'badAnswer'] as const)(
    'ends with words for %s',
    async (reason) => {
      const steps = fakeSteps({
        redeem: jest.fn(async () => {
          throw new VtaClaimError(reason)
        }),
      })
      const tree = await show(steps)
      await press(tree, VtaClaimIds.continue)
      expect(tree.getByTestId(id(VtaClaimIds.resultMessage))).toHaveTextContent(`VtaClaim.Failure.${reason}`)
    }
  )

  it('an agent set up but not yet answering says so, never "ready"', async () => {
    const tree = await show(fakeSteps({ finish: jest.fn(async () => ({ kind: 'failed' as const })) }))
    await press(tree, VtaClaimIds.continue)
    expect(tree.getByTestId(id(VtaClaimIds.resultMessage))).toHaveTextContent('VtaClaim.Failure.linkFailed')
  })

  it('a sign-in code, or no code, is not taken for a setup code', async () => {
    const signIn = LINK.replace('vta-claim', 'sign-in')
    const steps = fakeSteps()
    let tree = await show(steps, signIn)
    expect(tree.getByTestId(id(VtaClaimIds.resultMessage))).toHaveTextContent('VtaClaim.Failure.invalidCode')
    tree = await show(steps, '')
    expect(tree.getByTestId(id(VtaClaimIds.failed))).toBeTruthy()
    expect(steps.claim).not.toHaveBeenCalled()
  })

  it('cancelling while waiting leaves the screen', async () => {
    const steps = fakeSteps({ redeem: jest.fn(() => new Promise<never>(() => undefined)) })
    const tree = await show(steps)
    await press(tree, VtaClaimIds.continue)
    await press(tree, VtaClaimIds.codeCancel)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('who a code says it is from (VTI-LNK-050)', () => {
  it.each([
    ['did:webvh:QmScid:dids.example.org:farm-auth', 'dids.example.org/farm-auth'],
    ['did:webvh:QmScid:dids.example.org', 'dids.example.org'],
    ['did:webvh:QmScid:dids.example.org%3A8443:a:b', 'dids.example.org:8443/a/b'],
    ['did:web:example.org:users:x', 'example.org/users/x'],
    ['did:web:example.org', 'example.org'],
  ])('%s → %s', (did, shown) => expect(claimedDomainPath(did)).toBe(shown))

  it('a DID with no domain shows none', () => {
    expect(claimedDomainPath('did:key:z6MkExampleClaimantKey')).toBeUndefined()
    expect(claimedDomainPath('did:peer:2.Vz6Mk')).toBeUndefined()
  })
})

describe('the words', () => {
  const reasons = Object.keys(en.VtaClaim.Failure)
  it('every ending has words in every language, and no product name', () => {
    for (const [lang, dict] of [
      ['fr', fr],
      ['pt-br', ptBr],
    ] as const) {
      expect(Object.keys(dict.VtaClaim.Failure).sort()).toEqual([...reasons].sort())
      expect(Object.keys(dict.VtaClaim).sort()).toEqual(Object.keys(en.VtaClaim).sort())
      expect(lang).toBeTruthy()
    }
    expect(JSON.stringify(en.VtaClaim)).not.toMatch(/farm/i)
  })
})
