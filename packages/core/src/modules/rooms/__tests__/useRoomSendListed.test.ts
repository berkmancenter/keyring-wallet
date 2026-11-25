/**
 * A post the room's list shows leaves the outbox, whatever its own answer said (IN-736). A tester's two posts showed
 * twice each in an attributed room: delivered, and under them the same words marked "Not sent. Tap to try again".
 * Each write had landed and its answer had not come back as a success, and only a post whose answer came back knew
 * the key its record took, so nothing could match the listed record to the failed post.
 *
 * Every post goes with its own id as the write's idempotency key, and the service derives the record's key from it
 * (`RoomsService.postKeyFor`): known before anything is sent.
 */
import { act, renderHook } from '@testing-library/react-native'
import { DeviceEventEmitter } from 'react-native'

import { RoomsRefused, type RoomsService } from '../types'
import { listedKeyOf, ROOM_POST_FAILED_EVENT, useRoomSend } from '../useRoomSend'

const keyFor = (idempotencyKey: string) => `k-${idempotencyKey}`

/**
 * A service whose writes land at the host and whose answers `answer` decides: 'ok' answers with the key, 'lost'
 * rejects as an answer that never came back, 'held' waits for `release`.
 */
function writing({ postKeys = true }: { postKeys?: boolean } = {}) {
  let answer: 'ok' | 'lost' | 'held' = 'ok'
  let release: (ok: boolean) => void = () => undefined
  const landed: string[] = []
  const service = {
    ...(postKeys ? { postKeyFor: jest.fn(keyFor) } : {}),
    prepareWrite: jest.fn(async (_roomId: string, draft: { idempotencyKey: string }) => ({
      token: draft.idempotencyKey,
    })),
    confirmWrite: jest.fn(async (token: string) => {
      landed.push(keyFor(token))
      if (answer === 'lost') throw new Error('timed out waiting for the agent')
      if (answer === 'held')
        return new Promise((resolve, reject) => {
          release = (ok) => (ok ? resolve({ key: keyFor(token), version: 1 }) : reject(new Error('timed out')))
        })
      return { key: keyFor(token), version: 1 }
    }),
  } as unknown as RoomsService & { confirmWrite: jest.Mock; prepareWrite: jest.Mock }
  return {
    service,
    landed,
    answers: (next: typeof answer) => void (answer = next),
    release: (ok: boolean) => release(ok),
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined)
}

const open = (service: RoomsService, onScreen = true) =>
  renderHook(() => useRoomSend(service, 'room:first', () => undefined, { onScreen, roomName: 'First Room' }))

describe('a post whose write landed and whose answer did not come back', () => {
  test('is marked failed, and leaves the outbox once the room lists its record (the report)', async () => {
    const w = writing()
    w.answers('lost')
    const room = open(w.service)
    await act(async () => void room.result.current.send('Testing a message from Keyring'))
    await flush()
    const [post] = room.result.current.pending
    expect(post.state).toBe('failed')
    // The record's key was known at the send, and it is the one that landed.
    expect(listedKeyOf(post)).toBe(keyFor(post.localId))
    expect(w.landed).toEqual([keyFor(post.localId)])
    // The room's list carries it: the failed copy goes.
    await act(async () => room.result.current.settle(new Set([keyFor(post.localId), 'someone-elses'])))
    expect(room.result.current.pending).toEqual([])
    room.unmount()
  })

  test('two of them, as in the report: each leaves with its own record, and a third not listed stays (control)', async () => {
    const w = writing()
    w.answers('lost')
    const room = open(w.service)
    for (const text of ['Testing a message from Keyrinv', 'Testing a message from Keyring', 'Never reached the room'])
      await act(async () => void room.result.current.send(text))
    await flush()
    const byText = new Map(room.result.current.pending.map((p) => [p.text, p.localId]))
    await act(async () =>
      room.result.current.settle(
        new Set([
          keyFor(byText.get('Testing a message from Keyrinv')!),
          keyFor(byText.get('Testing a message from Keyring')!),
        ])
      )
    )
    expect(room.result.current.pending.map((p) => [p.text, p.state])).toEqual([['Never reached the room', 'failed']])
    room.unmount()
  })

  test('a service that cannot say the key ahead keeps a failed post however the room lists (control: before)', async () => {
    const w = writing({ postKeys: false })
    w.answers('lost')
    const room = open(w.service)
    await act(async () => void room.result.current.send('Testing a message from Keyring'))
    await flush()
    const [post] = room.result.current.pending
    expect(listedKeyOf(post)).toBeUndefined()
    await act(async () => room.result.current.settle(new Set([keyFor(post.localId)])))
    expect(room.result.current.pending.map((p) => p.state)).toEqual(['failed'])
    room.unmount()
  })
})

describe('a post the room lists while its write is still out', () => {
  test('leaves at once, and an answer that then fails brings no "Not sent" back, here or as a notice', async () => {
    const heard: unknown[] = []
    const sub = DeviceEventEmitter.addListener(ROOM_POST_FAILED_EVENT, (e) => heard.push(e))
    const w = writing()
    w.answers('held')
    // Off screen, where a failure would be said in a notice.
    const room = open(w.service, false)
    await act(async () => void room.result.current.send('Testing a message from Keyring'))
    await flush()
    const [post] = room.result.current.pending
    expect(post.state).toBe('sending')
    // A live watch lists the record before the write's answer arrives.
    await act(async () => room.result.current.settle(new Set([keyFor(post.localId)])))
    expect(room.result.current.pending).toEqual([])
    await act(async () => w.release(false))
    await flush()
    expect(room.result.current.pending).toEqual([])
    expect(heard).toEqual([])
    room.unmount()
    sub.remove()
  })

  test('and one whose answer then arrives is not drawn again either', async () => {
    const w = writing()
    w.answers('held')
    const room = open(w.service)
    await act(async () => void room.result.current.send('Testing a message from Keyring'))
    await flush()
    const [post] = room.result.current.pending
    await act(async () => room.result.current.settle(new Set([keyFor(post.localId)])))
    await act(async () => w.release(true))
    await flush()
    expect(room.result.current.pending).toEqual([])
    room.unmount()
  })
})

describe('the room is read again after a failure that was not a refusal', () => {
  test('a lost answer reads the room once; a refusal for good does not', async () => {
    const w = writing()
    const refresh = jest.fn()
    const room = renderHook(() => useRoomSend(w.service, 'room:first', refresh, { onScreen: true }))
    w.answers('lost')
    await act(async () => void room.result.current.send('Testing a message from Keyring'))
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    w.service.confirmWrite.mockRejectedValueOnce(new RoomsRefused('write', 'forbidden', false, 'refused'))
    await act(async () => void room.result.current.send('Refused'))
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    room.unmount()
  })
})

describe('as before (controls)', () => {
  test('a post written and answered leaves once listed, by the key its answer gave', async () => {
    const w = writing({ postKeys: false })
    const room = open(w.service)
    await act(async () => void room.result.current.send('On my way.'))
    await flush()
    const [post] = room.result.current.pending
    expect([post.state, post.key]).toEqual(['sent', keyFor(post.localId)])
    await act(async () => room.result.current.settle(new Set([keyFor(post.localId)])))
    expect(room.result.current.pending).toEqual([])
    room.unmount()
  })

  test('a post not yet listed stays, sending or sent', async () => {
    const w = writing()
    const room = open(w.service)
    await act(async () => void room.result.current.send('On my way.'))
    await flush()
    await act(async () => room.result.current.settle(new Set(['k-someone-else'])))
    expect(room.result.current.pending.map((p) => p.state)).toEqual(['sent'])
    room.unmount()
  })

  test('a retry of a failed post goes as the same event, so its record keeps the same key', async () => {
    const w = writing()
    w.answers('lost')
    const room = open(w.service)
    await act(async () => void room.result.current.send('Second try'))
    await flush()
    const [post] = room.result.current.pending
    w.answers('ok')
    await act(async () => room.result.current.retry(post.localId))
    await flush()
    expect(w.landed).toEqual([keyFor(post.localId), keyFor(post.localId)])
    expect(room.result.current.pending.map((p) => [p.state, p.key])).toEqual([['sent', keyFor(post.localId)]])
    room.unmount()
  })
})

// IN-776: one log line per post, from Send to written or failed, so a report shows what a post costs.
describe('the time a post takes from Send', () => {
  const timedService = (fail = false) => {
    const w = writing()
    if (fail) w.answers('lost')
    const notePostSent = jest.fn()
    Object.assign(w.service, { notePostSent })
    return { ...w, notePostSent }
  }

  test('written: said once, as written, with how long it took and how it went', async () => {
    const w = timedService()
    const room = open(w.service)
    await act(async () => void room.result.current.send('On my way.'))
    await flush()
    expect(w.notePostSent).toHaveBeenCalledTimes(1)
    const [roomId, ms, how] = w.notePostSent.mock.calls[0]
    expect([roomId, how]).toEqual(['room:first', { failed: false, asRecord: false, file: false }])
    expect(ms).toBeGreaterThanOrEqual(0)
    room.unmount()
  })

  test('failed: said once, as failed; a retry that then goes through is said again, as written', async () => {
    const w = timedService(true)
    const room = open(w.service)
    await act(async () => void room.result.current.send('Second try'))
    await flush()
    expect(w.notePostSent.mock.calls.map(([, , how]) => how.failed)).toEqual([true])
    w.answers('ok')
    await act(async () => room.result.current.retry(room.result.current.pending[0].localId))
    await flush()
    expect(w.notePostSent.mock.calls.map(([, , how]) => how.failed)).toEqual([true, false])
    room.unmount()
  })

  test('a service with nothing to log to is asked nothing (control: the sample)', async () => {
    const w = writing()
    const room = open(w.service)
    await act(async () => void room.result.current.send('On my way.'))
    await flush()
    expect(room.result.current.pending.map((p) => p.state)).toEqual(['sent'])
    room.unmount()
  })
})
