/**
 * The shared-connect confirm screen (plan WP3): what is shown, what is not,
 * and that nothing is sent before Connect — against fake steps.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { SessionState } from '../module/sharedConnect'
import type { SharedConnectPreview } from '../module/sharedConnectStart'
import { SharedConnectFlow, type SharedConnectSteps } from '../screens/SharedConnect'
import { SharedConnectIds } from '../screens/SharedConnect.ids'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const LINK = 'https://link.trustoverip.org/t#_from=did:peer:2.x&_id=XOcGXOQTCHb5iz4T2JD2RQ'
const PREVIEW: SharedConnectPreview = {
  inviterDid: 'did:peer:2.Vz6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK.Ez6LS',
  didShort: 'did:peer:2.Vz6MkhaXgBZDv…',
  label: 'Ada Lovelace',
  relayHost: 'relay.example.org',
  carriage: 'tsp',
  exp: 1_800_000_600,
  enactment: 'XOcGXOQTCHb5iz4T2JD2RQ',
}

const steps = (over: Partial<SharedConnectSteps> = {}): jest.Mocked<SharedConnectSteps> =>
  ({
    preview: jest.fn(async () => ({ kind: 'ready', preview: PREVIEW, endpoint: 'did:peer:2.m' })),
    start: jest.fn(async () => ({ kind: 'started', encounter: {} })),
    ...over,
  }) as jest.Mocked<SharedConnectSteps>

const onClose = jest.fn()
const show = async (s: SharedConnectSteps, link: string | null = LINK) => {
  const tree = render(
    <BasicAppContext>
      <SharedConnectFlow link={link ?? undefined} steps={s} onClose={onClose} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
const press = async (tree: ReturnType<typeof render>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })

beforeEach(() => onClose.mockReset())

describe('the confirm step', () => {
  it('shows the name marked unverified, a DID prefix, the relay host and the expiry', async () => {
    const tree = await show(steps())
    expect(tree.getByTestId(id(SharedConnectIds.confirm))).toBeTruthy()
    expect(tree.getByTestId(id(SharedConnectIds.name)).props.children).toBe('Ada Lovelace')
    expect(tree.getByTestId(id(SharedConnectIds.unverified))).toBeTruthy()
    expect(tree.getByTestId(id(SharedConnectIds.contact)).props.children).toBe(PREVIEW.didShort)
    expect(tree.getByTestId(id(SharedConnectIds.relay)).props.children).toBe('relay.example.org')
    expect(tree.getByTestId(id(SharedConnectIds.expires)).props.children).toBeDefined()
  })

  it('shows "No name given" and no unverified marker without a label, and "No relay name" without a host', async () => {
    const s = steps({
      preview: jest.fn(async () => ({
        kind: 'ready' as const,
        endpoint: 'did:peer:2.m',
        preview: { ...PREVIEW, label: undefined, relayHost: undefined },
      })),
    })
    const tree = await show(s)
    expect(tree.getByTestId(id(SharedConnectIds.name)).props.children).toBe('SharedConnect.NoName')
    expect(tree.queryByTestId(id(SharedConnectIds.unverified))).toBeNull()
    expect(tree.getByTestId(id(SharedConnectIds.relay)).props.children).toBe('SharedConnect.NoRelay')
  })

  it('never shows the link or the full DID', async () => {
    const tree = await show(steps())
    const text = JSON.stringify(tree.toJSON())
    expect(text).not.toContain('_from=')
    expect(text).not.toContain(PREVIEW.inviterDid)
    expect(text).not.toContain(PREVIEW.enactment)
  })

  it('sends nothing before Connect: the link is only read', async () => {
    const s = steps()
    await show(s)
    expect(s.preview).toHaveBeenCalledTimes(1)
    expect(s.start).not.toHaveBeenCalled()
  })

  it('Cancel closes without starting', async () => {
    const s = steps()
    const tree = await show(s)
    await press(tree, SharedConnectIds.cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(s.start).not.toHaveBeenCalled()
  })
})

describe('Connect', () => {
  it('starts once, with the link, and says it is ready', async () => {
    const s = steps()
    const tree = await show(s)
    await press(tree, SharedConnectIds.connect)
    expect(s.start).toHaveBeenCalledWith(LINK)
    expect(tree.getByTestId(id(SharedConnectIds.result))).toBeTruthy()
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Ready')
    await press(tree, SharedConnectIds.done)
    expect(onClose).toHaveBeenCalled()
  })

  it('starts once however many times Connect is pressed before the screen changes', async () => {
    const s = steps({ start: jest.fn(() => new Promise<never>(() => undefined)) })
    const tree = await show(s)
    const connect = tree.getByTestId(id(SharedConnectIds.connect))
    await act(async () => {
      // Three touches in one frame: no render in between.
      fireEvent.press(connect)
      fireEvent.press(connect)
      fireEvent.press(connect)
    })
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an expiry that passed meanwhile', { kind: 'refused', ui: 'expired' }, 'Scan.TriggerLinkExpired'],
    ['a failure', { kind: 'failed' }, 'SharedConnect.Failed'],
  ])('says so for %s', async (_, outcome, words) => {
    const tree = await show(steps({ start: jest.fn(async () => outcome as never) }))
    await press(tree, SharedConnectIds.connect)
    expect(JSON.stringify(tree.toJSON())).toContain(words)
  })

  it('says it could not be set up when the step throws', async () => {
    const tree = await show(steps({ start: jest.fn(async () => Promise.reject(new Error('x'))) }))
    await press(tree, SharedConnectIds.connect)
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Failed')
  })
})

describe('a link that cannot be used', () => {
  it.each([
    ['expired', 'Scan.TriggerLinkExpired'],
    ['unreachable', 'Scan.TriggerLinkUnreachable'],
    ['invalid', 'Scan.TriggerLinkInvalid'],
  ] as const)('says %s, with no Connect', async (ui, words) => {
    const s = steps({ preview: jest.fn(async () => ({ kind: 'refused' as const, ui })) })
    const tree = await show(s)
    expect(JSON.stringify(tree.toJSON())).toContain(words)
    expect(tree.queryByTestId(id(SharedConnectIds.connect))).toBeNull()
  })

  it('says it cannot be used when the screen holds no link, and reads nothing', async () => {
    const s = steps()
    const tree = await show(s, null)
    expect(JSON.stringify(tree.toJSON())).toContain('Scan.TriggerLinkInvalid')
    expect(s.preview).not.toHaveBeenCalled()
  })
})

describe('after Connect: waiting for the answer', () => {
  type Listener = (state: SessionState) => void
  const fakeSession = (outcome?: SessionState) => {
    const listeners = new Set<Listener>()
    const handle = {
      outcome,
      subscribe: jest.fn((l: Listener) => {
        listeners.add(l)
        return () => void listeners.delete(l)
      }),
      retry: jest.fn(async () => undefined),
      cancel: jest.fn(async () => undefined),
    }
    return { handle, emit: (state: SessionState) => listeners.forEach((l) => l(state)), listeners }
  }
  const started = async (session?: ReturnType<typeof fakeSession>) => {
    const s = steps({
      start: jest.fn(async () => ({ kind: 'started', encounter: { enactment: PREVIEW.enactment } }) as never),
      session: jest.fn(() => session?.handle),
    })
    const tree = await show(s)
    await press(tree, SharedConnectIds.connect)
    return { s, tree }
  }
  const emit = async (session: ReturnType<typeof fakeSession>, state: SessionState) =>
    act(async () => session.emit(state))

  it('looks the session up by enactment and shows waiting, with Stop', async () => {
    const session = fakeSession()
    const { s, tree } = await started(session)
    expect(s.session).toHaveBeenCalledWith(PREVIEW.enactment)
    expect(tree.getByTestId(id(SharedConnectIds.waiting))).toBeTruthy()
    await press(tree, SharedConnectIds.stop)
    expect(session.handle.cancel).toHaveBeenCalledTimes(1)
  })

  it('unanswered offers Ask again and Stop and is not shown as a failure; Ask again returns to waiting', async () => {
    const session = fakeSession()
    const { tree } = await started(session)
    await emit(session, 'unanswered')
    expect(tree.getByTestId(id(SharedConnectIds.unanswered))).toBeTruthy()
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Unanswered')
    expect(JSON.stringify(tree.toJSON())).not.toContain('SharedConnect.Failed')
    await press(tree, SharedConnectIds.retry)
    expect(session.handle.retry).toHaveBeenCalledTimes(1)
    await emit(session, 'waiting')
    expect(tree.getByTestId(id(SharedConnectIds.waiting))).toBeTruthy()
    await emit(session, 'unanswered')
    await press(tree, SharedConnectIds.stop)
    expect(session.handle.cancel).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['completed', 'SharedConnect.Completed'],
    ['expired', 'SharedConnect.Expired'],
    ['declined', 'SharedConnect.Declined'],
    ['refused', 'SharedConnect.Refused'],
    ['failed', 'SharedConnect.Cancelled'],
  ] as const)('%s ends with %s and Done', async (state, words) => {
    const session = fakeSession()
    const { tree } = await started(session)
    await emit(session, state)
    expect(tree.getByTestId(id(SharedConnectIds.result))).toBeTruthy()
    expect(JSON.stringify(tree.toJSON())).toContain(words)
    await press(tree, SharedConnectIds.done)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an ending the session already had when the screen found it, and stops listening on unmount', async () => {
    const ended = fakeSession('declined')
    const { tree } = await started(ended)
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Declined')
    const live = fakeSession()
    const second = await started(live)
    expect(live.listeners.size).toBe(1)
    second.tree.unmount()
    expect(live.listeners.size).toBe(0)
  })

  it('falls back to "request sent" when the session is already gone', async () => {
    const { tree } = await started(undefined)
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Ready')
  })
})
