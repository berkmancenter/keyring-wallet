/**
 * One desk per persona, however often the Vetting screen is entered.
 *
 * Measured 2026-09-25: a vetter's desk answered one request twice — two
 * acceptances on one thread, 90 ms apart. One way that happens is here: every
 * mount of the Vetting screen made a new `VtiVetterDesk` and told it to
 * listen, and nothing stopped it when the screen went away. Leave Vetting and
 * come back, and two desks hear every request. (PR C made taking a request
 * idempotent; this removes the second listener itself.)
 */
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import VtiVetting from '../screens/VtiVetting'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { VETTING, VtiVetterDesk } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const mockUseAgent = useAgent as jest.Mock
const communityDid = 'did:webvh:example:community'
const personaDid = 'did:webvh:example:persona'
const config = { mediatorDid: 'did:peer:2:mediator', communityDid }

type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
const records: Rec[] = [
  {
    tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
    content: {
      communityDid,
      vtaDid: 'did:webvh:example:linked-vta',
      did: personaDid,
      contextId: 'vta',
      vtaKeyIds: { signing: 's', keyAgreement: 'k' },
      kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
      createdAt: '2026-09-23T00:00:00Z',
    },
  },
  {
    // A vetter grant for the persona, so the screen seats it at the desk.
    tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'urn:uuid:grant' },
    content: {
      kind: 'vetter-grant',
      communityDid,
      subjectDid: personaDid,
      credential: { id: 'urn:uuid:grant', issuer: communityDid },
      receivedAt: '2026-09-23T00:00:00Z',
    },
  },
]
const agent = {
  genericRecords: {
    findAllByQuery: async (query: Record<string, string>) =>
      records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map((r) => ({ ...r, id: 'r' })),
    save: async () => undefined,
    update: async () => undefined,
    delete: async () => undefined,
  },
  dids: { resolveDidDocument: async () => Promise.reject(new Error('offline')) },
  config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
}

const inbox = () => (vtiAgent as unknown as { inbox: unknown[] }).inbox.length
const deliver = (m: unknown) => (vtiAgent as unknown as { deliver(m: unknown): Promise<void> }).deliver(m)
const request = {
  id: 'urn:uuid:didcomm-1',
  type: VETTING.request,
  from: 'did:key:z6MkApplicant',
  body: { id: 'urn:uuid:request-1', type: VETTING.request, issuer: 'did:key:z6MkApplicant', payload: {} },
}

describe('the Vetting screen and its desk', () => {
  const listen = jest.spyOn(VtiVetterDesk.prototype, 'listen')
  const heard = jest.spyOn(VtiVetterDesk.prototype as unknown as { inbound(m: unknown): Promise<void> }, 'inbound')

  beforeEach(() => {
    jest.useFakeTimers()
    mockUseAgent.mockReturnValue({ agent })
    ;(vtaAgent as unknown as { set(next: Record<string, unknown>): void }).set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:linked-vta',
        label: 'alice',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    listen.mockClear()
    heard.mockClear()
  })
  afterEach(() => jest.useRealTimers())

  const mount = async () => {
    const before = listen.mock.calls.length
    const tree = render(
      <BasicAppContext>
        <VtiVetting config={config} />
      </BasicAppContext>
    )
    await waitFor(() => expect(listen.mock.calls.length).toBeGreaterThan(before))
    return tree
  }

  it('leaving the screen stops its desk listening', async () => {
    const baseline = inbox()
    const tree = await mount()
    expect(inbox()).toBeGreaterThan(baseline)
    tree.unmount()
    expect(inbox()).toBe(baseline)
  })

  it('leaving and coming back: one desk hears a request, not two', async () => {
    const first = await mount()
    first.unmount()
    const second = await mount()
    await deliver(request)
    expect(heard).toHaveBeenCalledTimes(1)
    second.unmount()
  })
})
