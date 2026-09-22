/**
 * Vetting — which agent the screen works with. Store builds name no VTA, so
 * testers link their own; the screen must take the linked one, or it stops at
 * "No agent is configured for this build" before a person can do anything.
 */
import { render, act } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import VtiVetting from '../screens/VtiVetting'
import { vtaAgent } from '../module/vtaAgent'
import { resolveVtaDid } from '../module/vtaLinkMachine'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }
const mockUseAgent = useAgent as jest.Mock
const setVta = (next: Record<string, unknown>) => (vtaAgent as unknown as Setter).set(next)

const linkedVtaDid = 'did:webvh:example:linked-vta'
// What a store build carries: a mediator and a community, no VTA.
const storeConfig = { mediatorDid: 'did:peer:2:mediator', communityDid: 'did:webvh:example:community' }

const linked = {
  kind: 'linked',
  vtaDid: linkedVtaDid,
  label: 'alice',
  linkedAt: '2026-09-22T00:00:00Z',
  connection: { kind: 'online', since: 0 },
}

function fakeAgent() {
  return {
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
  }
}

describe('resolveVtaDid', () => {
  test('the linked agent wins over the one a build names', () => {
    expect(resolveVtaDid(linked as never, 'did:webvh:example:built-in')).toBe(linkedVtaDid)
  })
  test('with no link, the build’s agent', () => {
    expect(resolveVtaDid({ kind: 'notLinked' }, 'did:webvh:example:built-in')).toBe('did:webvh:example:built-in')
  })
  test('with neither, none', () => {
    expect(resolveVtaDid({ kind: 'notLinked' })).toBeUndefined()
  })
})

describe('Vetting — the agent it works with', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockUseAgent.mockReturnValue(fakeAgent())
    setVta({ link: { kind: 'notLinked' } })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const renderVetting = async () => {
    const tree = render(
      <BasicAppContext>
        <VtiVetting config={storeConfig} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  test('a linked agent and no build VTA: the first step, not "not configured"', async () => {
    setVta({ link: linked })
    const tree = await renderVetting()
    expect(tree.queryByText('MyAgent.NotConfigured')).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('VettingCreateIdentityButton'))).toBeTruthy()
  })

  test('no linked agent and no build VTA: says so', async () => {
    const tree = await renderVetting()
    expect(tree.queryByText('MyAgent.NotConfigured')).toBeTruthy()
  })
})
