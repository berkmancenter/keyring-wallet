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
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import VtiVetting from '../screens/VtiVetting'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { VETTING, VtiApplicant, VtiVetterDesk } from '../module/vtiVetting'

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
// While set, the seat's grant read waits on it: the seconds a status read can take on a phone.
let grantReadHeld: Promise<void> | undefined
const agent = {
  genericRecords: {
    findAllByQuery: async (query: Record<string, string>) => {
      if (query.kind === 'credential' && grantReadHeld) await grantReadHeld
      return records
        .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
        .map((r) => ({ ...r, id: 'r', content: { ...r.content } }))
    },
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

  // 276.10: a vetting request reached the vetter's listener while another community held the shared session. The
  // listener now leaves it on the mediator and names the identity; the screen signs the session in as it again.
  it('a message waiting for its persona signs the session in as it again; one for another identity does not', async () => {
    const connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
    const tree = await mount()
    await waitFor(() => expect(connect).toHaveBeenCalled())
    const before = connect.mock.calls.length
    DeviceEventEmitter.emit('vti:persona-message-waiting', { did: 'did:webvh:example:someone-else' })
    await act(async () => undefined)
    expect(connect).toHaveBeenCalledTimes(before)
    DeviceEventEmitter.emit('vti:persona-message-waiting', { did: personaDid })
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(before + 1))
    expect(connect.mock.calls[before][2]).toMatchObject({ persona: expect.objectContaining({ did: personaDid }) })
    tree.unmount()
    connect.mockRestore()
  })

  it('leaving and coming back: one desk hears a request, not two', async () => {
    const first = await mount()
    first.unmount()
    const second = await mount()
    await deliver(request)
    expect(heard).toHaveBeenCalledTimes(1)
    second.unmount()
  })

  // 277.7, 0.69 gate kk (2026-11-03): the vetter's listener left a vetting request on the mediator and named the
  // persona; the screen signed the session in again, and the mediator delivered the request while the desk was
  // unhooked: the re-run of the screen's connect handed it a new persona object, the desk effect's cleanup stopped
  // the desk, and it listened again only after the grant read. The request was acknowledged and never reached it.
  describe('a vetting request delivered while the seat is read again', () => {
    let release: () => void = () => undefined
    const holdGrantRead = () => {
      grantReadHeld = new Promise<void>((resolve) => (release = resolve))
    }
    afterEach(() => {
      release()
      grantReadHeld = undefined
    })

    it('after the bump a waiting message makes: the desk hears it', async () => {
      const connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
      const tree = await mount()
      await waitFor(() => expect(connect).toHaveBeenCalled())
      const before = connect.mock.calls.length
      holdGrantRead()
      DeviceEventEmitter.emit('vti:persona-message-waiting', { did: personaDid })
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(before + 1))
      await act(async () => undefined)
      await deliver(request)
      expect(heard).toHaveBeenCalledTimes(1)
      tree.unmount()
      connect.mockRestore()
    })

    it('after the persona itself changed and the seat is read again: the desk hears it', async () => {
      // A stored persona that really changed is a new object, and the desk effect runs again. The seated desk
      // listens again before the read, not after it.
      const connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
      const tree = await mount()
      await waitFor(() => expect(connect).toHaveBeenCalled())
      const before = connect.mock.calls.length
      holdGrantRead()
      const persona = records[0].content
      const createdAt = persona.createdAt
      persona.createdAt = '2026-11-03T22:12:18Z'
      try {
        DeviceEventEmitter.emit('vti:persona-message-waiting', { did: personaDid })
        await waitFor(() => expect(connect).toHaveBeenCalledTimes(before + 1))
        await act(async () => undefined)
        await deliver(request)
        expect(heard).toHaveBeenCalledTimes(1)
      } finally {
        persona.createdAt = createdAt
        tree.unmount()
        connect.mockRestore()
      }
    })
  })

  // A seat that changes side: the grant record is gone, so the next read seats the applicant. The desk must stop,
  // or it takes a vetting request it cannot serve and the mediator counts it delivered.
  it('a desk whose grant is gone stops listening when the applicant is seated', async () => {
    const connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
    const applicantListens = jest.spyOn(VtiApplicant.prototype, 'listen')
    const tree = await mount()
    applicantListens.mockClear()
    const grant = records.splice(1, 1)
    try {
      await act(async () => {
        jest.advanceTimersByTime(3000)
      })
      await waitFor(() => expect(applicantListens).toHaveBeenCalled())
      await act(async () => undefined)
      await deliver(request)
      expect(heard).not.toHaveBeenCalled()
    } finally {
      records.splice(1, 0, ...grant)
      tree.unmount()
      connect.mockRestore()
      applicantListens.mockRestore()
    }
  })
})
