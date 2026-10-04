/**
 * A removed phone is told so where it lands (#10, 226 gate): My Agent's two
 * landings show "no longer linked to your agent" with Erase and Link again,
 * not the plain first-link prompt. Nothing is erased by itself.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import MyAgent from '../screens/MyAgent'
import VtaAgentHome from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: { consentRequest: 'consent-request', consentGranted: 'consent-granted' },
  resolveVtaMediator: async () => Promise.reject(new Error('offline')),
  VtaClient: class {
    isConnected = true
    managerDid = 'did:key:z6MkManager'
    async connect() {}
    async whoAmI() {
      return {}
    }
    async ensureManagerIdentity() {
      return 'did:key:z6MkManager'
    }
  },
}))

type Setter = { set(next: Record<string, unknown>): void }
const id = (key: string) => testIdWithKey(key)
const controller = vtaAgent as unknown as Setter & { eraseThisPhonesCopy: jest.Mock }
const mockUseAgent = useAgent as jest.Mock
const erase = jest.fn()

const fakeAgent = () => ({
  agent: {
    genericRecords: {
      findAllByQuery: async () => [],
      save: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
    dids: { resolveDidDocument: async () => Promise.reject(new Error('offline')) },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  },
})

const removed = (cause: 'wiped' | 'notInAcl' = 'notInAcl') =>
  controller.set({
    link: { kind: 'revoked', vtaDid: 'did:webvh:example:vta', label: 'bob', reason: 'not in ACL', cause },
  })

const show = async (screen: React.ReactElement) => {
  const tree = render(<BasicAppContext>{screen}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}

beforeEach(() => {
  mockUseAgent.mockReturnValue(fakeAgent())
  erase.mockReset().mockResolvedValue(undefined)
  controller.eraseThisPhonesCopy = erase
})

afterEach(() => controller.set({ link: { kind: 'notLinked' } }))

describe.each([
  ['the agent screen', () => <VtaAgentHome />],
  ['My Agent', () => <MyAgent />],
])('a removed phone landing on %s', (_where, screen) => {
  test('is told it is no longer linked, with Erase and Link again, not the plain link prompt', async () => {
    removed()
    const tree = await show(screen())
    expect(tree.getByText('VtaLink.RevokedTitle')).toBeTruthy()
    expect(tree.getByTestId(id('VtaLinkError'))).toHaveTextContent('VtaLink.RevokedBody')
    expect(tree.getByTestId(id('VtaLinkErase'))).toBeTruthy()
    expect(tree.getByTestId(id('VtaLinkScanAgain'))).toBeTruthy()
    expect(tree.queryByTestId(id('AgentHomeLink'))).toBeNull()
    expect(tree.queryByTestId(id('MyAgentLinkCard'))).toBeNull()
    expect(erase).not.toHaveBeenCalled()
  })

  test('can erase from there, once confirmed', async () => {
    removed('wiped')
    const tree = await show(screen())
    expect(tree.getByTestId(id('VtaLinkError'))).toHaveTextContent('VtaLink.RevokedBodyWiped')
    fireEvent.press(tree.getByTestId(id('VtaLinkErase')))
    expect(tree.getByTestId(id('VtaLinkEraseWhat'))).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('VtaLinkEraseConfirm')))
    })
    expect(erase).toHaveBeenCalledTimes(1)
  })
})

// 233 final gate (iPhone SE): under the removed-phone card, My Agent also said
// "That didn't work, and the app doesn't know why" — the refused sign-in behind
// the removal, said a second time as an unknown failure.
test('My Agent says a removal once: no generic failure line under the removed-phone card', async () => {
  removed()
  // The shared session's sign-in failed after the removal: its error is what the panel said.
  const shared = vtiAgent as unknown as { set(next: Record<string, unknown>): void }
  shared.set({ error: "Key with key id 'vta-copy:…' not found" })
  const tree = await show(<MyAgent />)
  expect(tree.getByText('VtaLink.RevokedTitle')).toBeTruthy()
  expect(tree.queryByTestId(id('MyAgentError'))).toBeNull()
  shared.set({ error: undefined })
})
