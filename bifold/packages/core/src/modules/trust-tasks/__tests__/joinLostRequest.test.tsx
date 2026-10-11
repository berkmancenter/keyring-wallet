/**
 * A join request lost on the way (238, #347), end to end on the Join screen.
 *
 * The phone records a request as sent before it sends it. When the send then
 * fails, the record stays "sent" with no answer; when the community, asked
 * later, holds no such request, Join says it never arrived and offers to send
 * it again — under the same identity, as the one request the phone keeps.
 * And a failure before the record (the community's mediator unreachable, so no
 * session and no manifest) records nothing: an error, never "lost".
 *
 * The device gate cannot force the first case (its network cut lands before
 * the record: everything up to the send needs the same mediator), so it is
 * held here. The real join (vtiJoin, joinSubmission, both record stores) runs
 * over an in-memory record store; only the network is faked: the VTA's
 * identity service and the community's messaging (vtiAgent).
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { JoinAsks, JoinWay } from '../module/joinManifest'
import { setCurrentAgentDid } from '../module/currentAgent'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { readJoinState } from '../module/vtiJoin'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'
import VtiJoin from '../screens/VtiJoin'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../../vrc/vrc-biometric', () => ({
  requestBiometricConfirmationWithUI: jest.fn(async () => ({ success: true, reason: 'confirmed' })),
}))
// What the community offers, as the manifest reader makes it: one way, reviewed by an administrator.
const mockJoinAsks = jest.fn()
jest.mock('../module/joinManifest', () => ({
  ...jest.requireActual('../module/joinManifest'),
  joinAsks: (...args: unknown[]) => mockJoinAsks(...args),
}))
jest.mock('../screens/joinHolds', () => ({ readJoinHolds: async () => ({}) }))

type Setter = { set(next: Record<string, unknown>): void }
const VTA = 'did:webvh:example:vta'
const COMMUNITY = 'did:webvh:QmLost:vtc.lost.example'
const config = { mediatorDid: 'did:peer:2:mediator', communityDid: COMMUNITY }
const id = (key: string) => testIdWithKey(key)

const review: JoinWay = {
  id: 'review',
  admission: 'review',
  requires: { invitation: false },
  requiresNothing: true,
  usable: true,
  meets: 'yes',
  digest: 'digest-review',
}
const offer: JoinAsks = { wire: '0.3', accepting: true, ways: [review], suggested: review, outcomeIfMet: 'reviewed' }
const manifest = { wire: '0.3', criteria: [] }

/** The agent's generic records, in memory: what both record stores write through. */
type Rec = { id: string; content: Record<string, unknown>; tags: Record<string, string>; createdAt: Date }
function recordsAgent() {
  const records: Rec[] = []
  let n = 0
  const genericRecords = {
    findAllByQuery: jest.fn(async (q: Record<string, string>) =>
      records.filter((r) => Object.entries(q).every(([k, v]) => r.tags[k] === v))
    ),
    save: jest.fn(async (r: { content: Record<string, unknown>; tags: Record<string, string> }) => {
      n += 1
      records.push({ id: `r${n}`, content: r.content, tags: r.tags, createdAt: new Date(n) })
    }),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async (r: Rec) => {
      const i = records.indexOf(r)
      if (i >= 0) records.splice(i, 1)
    }),
    deleteById: jest.fn(async (rid: string) => {
      const i = records.findIndex((r) => r.id === rid)
      if (i >= 0) records.splice(i, 1)
    }),
  }
  const agent = { config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }, genericRecords }
  const submissions = () =>
    records.filter((r) => r.tags.kind === 'submission').map((r) => r.content as Record<string, unknown>)
  return { agent, records, submissions }
}

describe('a join request lost on the way (#347)', () => {
  let phone: ReturnType<typeof recordsAgent>
  /** Identities the VTA made: one per community, kept by the identity store as the real client keeps them. */
  let made: VtiPersona[]
  let connect: jest.SpyInstance
  let apply: jest.SpyInstance
  let status: jest.SpyInstance
  let fetchManifest: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    communityTarget.clear()
    communityTarget.set({ communityDid: COMMUNITY, name: 'Lost Lab' })
    setCurrentAgentDid(VTA)
    mockJoinAsks.mockReturnValue(offer)
    phone = recordsAgent()
    ;(useAgent as jest.Mock).mockReturnValue({ agent: phone.agent })
    ;(vtaAgent as unknown as Setter).set({
      link: {
        kind: 'linked',
        vtaDid: VTA,
        label: 'bob',
        linkedAt: '2026-10-11T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    made = []
    jest.spyOn(vtaAgent, 'client').mockImplementation(((_agent: unknown, vtaDid: string, store: VtiIdentityStore) => ({
      ensurePersona: async ({ communityDid }: { communityDid: string }) => {
        const kept = await store.getPersona(communityDid)
        if (kept) return kept
        const persona = {
          did: `did:webvh:QmPersona${made.length + 1}:p`,
          communityDid,
          vtaDid,
          kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
        } as VtiPersona
        made.push(persona)
        await store.setPersona(persona)
        return persona
      },
    })) as never)
    fetchManifest = jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue(manifest as never)
    connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined as never)
    jest.spyOn(vtiAgent, 'onInbound').mockReturnValue((() => undefined) as never)
    apply = jest.spyOn(vtiAgent, 'apply')
    status = jest.spyOn(vtiAgent, 'status')
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    setCurrentAgentDid(undefined)
  })

  /** Open Join on the community, as a link brings it. */
  const openJoin = async () => {
    const tree = render(
      <BasicAppContext>
        <VtiJoin config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }
  /** "Ask to join", then Continue as the identity offered. */
  const ask = async (tree: Awaited<ReturnType<typeof openJoin>>) => {
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
    expect(tree.getByTestId(id('JoinMakeIdentity'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
  }

  it('a send that fails after the request is recorded: said lost, and sent again as the same request', async () => {
    // The ask goes; its delivery fails (the mediator's socket dropped mid-send).
    apply.mockRejectedValueOnce(new Error('socket failed to open: network connection lost'))
    let tree = await openJoin()
    await ask(tree)

    // Recorded before the send, and nothing since: sent, with no answer.
    expect(made).toHaveLength(1)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(phone.submissions()).toEqual([
      expect.objectContaining({ communityDid: COMMUNITY, personaDid: made[0].did, via: 'join', withInvitation: false }),
    ])
    expect(phone.submissions()[0].acknowledgedAt).toBeUndefined()
    expect(phone.submissions()[0].status).toBeUndefined()
    await expect(readJoinState(phone.agent as never, COMMUNITY, { poll: false })).resolves.toMatchObject({
      kind: 'sent',
    })
    expect(tree.getByTestId(id('JoinError'))).toBeTruthy()
    tree.unmount()

    // Join again: asked, the community holds no such request.
    status.mockResolvedValue(undefined)
    tree = await openJoin()
    expect(status).toHaveBeenCalledWith(COMMUNITY, expect.anything())
    expect(tree.getByTestId(id('JoinRequestLost'))).toHaveTextContent(/Join\.RequestLost/)
    expect(tree.queryByTestId(id('JoinRequestSent'))).toBeNull()

    // Send it again: this time it arrives, and an administrator will review it.
    apply.mockResolvedValueOnce({ effect: 'refer', requestId: 'urn:uuid:again' } as never)
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinSendAgain'))))
    expect(tree.getByTestId(id('JoinMakeIdentity'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))

    // The same request again: the same identity, the same community and manifest, the same (empty) presentation.
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply.mock.calls[1]).toEqual(apply.mock.calls[0])
    expect(new Set(connect.mock.calls.map(([, , o]) => (o as { persona: VtiPersona }).persona.did))).toEqual(
      new Set([made[0].did])
    )
    // No second identity, and still the one request: answered now.
    expect(made).toHaveLength(1)
    expect(phone.submissions()).toHaveLength(1)
    expect(phone.submissions()[0]).toMatchObject({
      personaDid: made[0].did,
      requestId: 'urn:uuid:again',
      status: 'pending',
    })
    expect(tree.getByTestId(id('JoinRequestSent'))).toBeTruthy()
    expect(tree.queryByTestId(id('JoinRequestLost'))).toBeNull()
    expect(tree.queryByTestId(id('JoinError'))).toBeNull()
  })

  // What the device gate sees with the community's mediator blocked before the tap.
  it.each([
    ['the mediator cannot be reached (no session)', 'connect'],
    ['the manifest cannot be read', 'manifest'],
  ])('%s: nothing is recorded, an error is shown, and nothing is said lost', async (_what, where) => {
    const offline = new Error('socket failed to open: network connection lost')
    if (where === 'connect') connect.mockRejectedValue(offline)
    // The screen reads the manifest first (what the community asks); the join's own read fails.
    else fetchManifest.mockResolvedValueOnce(manifest as never).mockRejectedValue(offline)
    let tree = await openJoin()
    await ask(tree)

    expect(apply).not.toHaveBeenCalled()
    expect(phone.submissions()).toEqual([])
    expect(tree.getByTestId(id('JoinError'))).toBeTruthy()
    expect(tree.queryByTestId(id('JoinRequestLost'))).toBeNull()
    expect(tree.queryByTestId(id('JoinRequestSent'))).toBeNull()
    tree.unmount()

    // Join again: nothing was sent, so nothing is lost and the community is not asked.
    tree = await openJoin()
    await expect(readJoinState(phone.agent as never, COMMUNITY)).resolves.toEqual({ kind: 'none' })
    expect(status).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('JoinRequestLost'))).toBeNull()
    expect(tree.getByTestId(id('JoinStart'))).toBeTruthy()
  })
})
