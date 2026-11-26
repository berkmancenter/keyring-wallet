/**
 * A remote VRC step that arrives late waits for both people (IN-448): held until a ready-check is answered within
 * READY_WINDOW_MS, never signed for someone who said ready long after they were asked.
 */
import {
  answerPeerCheck,
  askPeerReady,
  handleLateStepMessage,
  keepHold,
  LATE_HOLD_METADATA_KEY,
  LATE_STEP_MS,
  lateStepMessageOf,
  lateStepStore,
  minutesOf,
  noteQueueStatus,
  queueWaitMs,
  READY_WINDOW_MS,
  readyAnswerMessage,
  readyCheckMessage,
  resetQueueStatus,
  stopExchange,
  stopMessage,
} from '../../../src/modules/vrc/lateStep'
import { vrcFlowStore } from '../../../src/modules/vrc/witnessStatusStore'

const T0 = Date.parse('2026-11-03T18:08:03.000Z')

function fakeAgent() {
  const metadata = new Map<string, unknown>()
  const connection = {
    id: 'conn-1',
    metadata: {
      get: (k: string) => metadata.get(k) ?? null,
      set: (k: string, v: unknown) => void metadata.set(k, v),
      delete: (k: string) => void metadata.delete(k),
    },
  }
  const sent: Array<{ connectionId: string; content: string }> = []
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    modules: {
      didcomm: {
        basicMessages: {
          sendMessage: jest.fn(
            async (connectionId: string, content: string) => void sent.push({ connectionId, content })
          ),
        },
        connections: {
          getById: jest.fn(async () => connection),
          findById: jest.fn(async () => connection),
          update: jest.fn(async () => undefined),
        },
      },
    },
  }
  return { agent: agent as never, sent, metadata }
}

beforeEach(() => {
  lateStepStore.reset()
  resetQueueStatus()
  vrcFlowStore.clearFlow('conn-1')
})

describe('how long the message being processed waited', () => {
  it('is now minus the pickup status oldest_received_time', () => {
    noteQueueStatus(new Date(T0 - 49 * 60_000), T0)
    expect(queueWaitMs(T0 + 500)).toBe(49 * 60_000 + 500)
  })

  it('is 0 with no status, a status naming no time, or a status over a minute old', () => {
    expect(queueWaitMs(T0)).toBe(0)
    noteQueueStatus(undefined, T0)
    expect(queueWaitMs(T0)).toBe(0)
    noteQueueStatus(new Date(T0 - 49 * 60_000), T0)
    expect(queueWaitMs(T0 + 61_000)).toBe(0)
  })

  it('reads the wire form too (an ISO string)', () => {
    noteQueueStatus('2026-11-03T17:19:31.000Z', T0)
    expect(minutesOf(queueWaitMs(T0))).toBe(49)
  })
})

describe('a held step', () => {
  it('keeps what it holds, in order, and hands it back once', () => {
    const order: string[] = []
    expect(lateStepStore.defer('conn-1', async () => void order.push('never'))).toBe(false)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: LATE_STEP_MS, now: T0 })
    expect(lateStepStore.defer('conn-1', async () => void order.push('announce'))).toBe(true)
    expect(lateStepStore.defer('conn-1', async () => void order.push('open'))).toBe(true)
    const steps = lateStepStore.release('conn-1')
    expect(steps).toHaveLength(2)
    expect(lateStepStore.isHeld('conn-1')).toBe(false)
    expect(lateStepStore.release('conn-1')).toHaveLength(0)
  })

  it('a second hold keeps the first and the longer wait', () => {
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 11 * 60_000, now: T0 })
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'accepted', waitedMs: 49 * 60_000, now: T0 + 1 })
    expect(lateStepStore.get('conn-1')).toMatchObject({ reason: 'connected', waitedMs: 49 * 60_000, heldAt: T0 })
  })

  it('a ready answer within the window releases it; later, it is asked again, never released', () => {
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: LATE_STEP_MS })
    lateStepStore.asked('conn-1', 'c1', T0)
    expect(lateStepStore.answered('conn-1', 'c1', true, T0 + READY_WINDOW_MS)).toBe('release')

    lateStepStore.asked('conn-1', 'c2', T0)
    expect(lateStepStore.answered('conn-1', 'c2', true, T0 + READY_WINDOW_MS + 1)).toBe('late')
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'held', note: 'lateReady', dismissed: false })
    expect(lateStepStore.get('conn-1')?.check).toBeUndefined()
  })

  // One guard covers three cases today; pinned apart so a split of it cannot change one of them silently.
  it('a "ready" with no check outstanding changes nothing, held or not', () => {
    expect(lateStepStore.answered('conn-1', 'c1', true, T0)).toBe('stale')
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: LATE_STEP_MS })
    expect(lateStepStore.answered('conn-1', 'c1', true, T0)).toBe('stale')
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'held' })
    expect(lateStepStore.isHeld('conn-1')).toBe(true)
  })

  it('"not now" leaves it held with that said; an answer to another check changes nothing', () => {
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: LATE_STEP_MS })
    lateStepStore.asked('conn-1', 'c1', T0)
    expect(lateStepStore.answered('conn-1', 'c0', true, T0 + 1)).toBe('stale')
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'asking' })
    expect(lateStepStore.answered('conn-1', 'c1', false, T0 + 1)).toBe('notNow')
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'held', note: 'notNow' })
    // Nothing is asking any more: even a timely ready to c1 is stale now.
    expect(lateStepStore.answered('conn-1', 'c1', true, T0 + 2)).toBe('stale')
  })

  it('"Stop for now" puts it aside and stops the check counting', () => {
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: LATE_STEP_MS })
    lateStepStore.asked('conn-1', 'c1', T0)
    lateStepStore.dismiss('conn-1', true)
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'held', dismissed: true })
    expect(lateStepStore.answered('conn-1', 'c1', true, T0 + 1)).toBe('stale')
    lateStepStore.reopen('conn-1')
    expect(lateStepStore.get('conn-1')).toMatchObject({ dismissed: false })
  })
})

describe('the messages', () => {
  it('round-trip, and anything else is not one of them', () => {
    expect(lateStepMessageOf(JSON.parse(readyCheckMessage('c1', 49 * 60_000)))).toEqual({
      kind: 'check',
      checkId: 'c1',
      waitedMs: 49 * 60_000,
    })
    expect(lateStepMessageOf(JSON.parse(readyAnswerMessage('c1', false)))).toEqual({
      kind: 'answer',
      checkId: 'c1',
      ready: false,
    })
    expect(lateStepMessageOf(JSON.parse(stopMessage()))).toEqual({ kind: 'stop' })
    expect(lateStepMessageOf({ type: 'session-challenge', checkId: 'c1' })).toBeUndefined()
    expect(lateStepMessageOf({ type: 'vrc-ready', checkId: 'c1' })).toBeUndefined()
    expect(lateStepMessageOf({ type: 'vrc-ready-check' })).toBeUndefined()
    expect(lateStepMessageOf(null)).toBeUndefined()
  })
})

describe('the two phones', () => {
  it('the inviter asks; a timely "ready" runs what was held, and marks the kept hold released', async () => {
    const { agent, sent, metadata } = fakeAgent()
    const ran = jest.fn(async () => undefined)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 49 * 60_000 })
    lateStepStore.defer('conn-1', ran)
    await keepHold(agent, 'conn-1', 49 * 60_000)
    expect(metadata.get(LATE_HOLD_METADATA_KEY)).toMatchObject({ waitedMs: 49 * 60_000 })

    await askPeerReady(agent, 'conn-1')
    const check = lateStepMessageOf(JSON.parse(sent[0].content))
    expect(check).toMatchObject({ kind: 'check', waitedMs: 49 * 60_000 })
    expect(ran).not.toHaveBeenCalled()

    const checkId = (check as { checkId: string }).checkId
    await handleLateStepMessage(agent, 'conn-1', { kind: 'answer', checkId, ready: true })
    expect(ran).toHaveBeenCalledTimes(1)
    expect(lateStepStore.isHeld('conn-1')).toBe(false)
    // Kept, marked released: nothing stored is deleted.
    expect(metadata.get(LATE_HOLD_METADATA_KEY)).toMatchObject({
      waitedMs: 49 * 60_000,
      releasedAt: expect.any(Number),
    })
  })

  // IN-448's 19:10: the other person said ready an hour after being asked. Nothing is signed; the inviter is asked.
  it('a "ready" long after the check runs nothing', async () => {
    const { agent, sent } = fakeAgent()
    const ran = jest.fn(async () => undefined)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 49 * 60_000 })
    lateStepStore.defer('conn-1', ran)
    await askPeerReady(agent, 'conn-1')
    const { checkId } = lateStepMessageOf(JSON.parse(sent[0].content)) as { checkId: string }
    await handleLateStepMessage(agent, 'conn-1', { kind: 'answer', checkId, ready: true }, Date.now() + 62 * 60_000)
    expect(ran).not.toHaveBeenCalled()
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'held', note: 'lateReady' })
  })

  it('the other phone is asked, answers ready, and its own hold goes too', async () => {
    const { agent, sent } = fakeAgent()
    const own = jest.fn(async () => undefined)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 62 * 60_000 })
    lateStepStore.defer('conn-1', own)
    await handleLateStepMessage(agent, 'conn-1', { kind: 'check', checkId: 'c9', waitedMs: 49 * 60_000 })
    expect(lateStepStore.getAnyPeerCheck()).toMatchObject({ connectionId: 'conn-1', checkId: 'c9' })

    await answerPeerCheck(agent, 'conn-1', true)
    expect(lateStepMessageOf(JSON.parse(sent[0].content))).toEqual({ kind: 'answer', checkId: 'c9', ready: true })
    expect(lateStepStore.getAnyPeerCheck()).toBeUndefined()
    expect(own).toHaveBeenCalledTimes(1)
  })

  it('"not now" on the other phone answers so, and releases nothing', async () => {
    const { agent, sent } = fakeAgent()
    const own = jest.fn(async () => undefined)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 62 * 60_000 })
    lateStepStore.defer('conn-1', own)
    await handleLateStepMessage(agent, 'conn-1', { kind: 'check', checkId: 'c9', waitedMs: 0 })
    await answerPeerCheck(agent, 'conn-1', false)
    expect(lateStepMessageOf(JSON.parse(sent[0].content))).toEqual({ kind: 'answer', checkId: 'c9', ready: false })
    expect(own).not.toHaveBeenCalled()
    expect(lateStepStore.isHeld('conn-1')).toBe(true)
  })

  it('a ready-check that fails to send leaves the card asking here, not saying "Asked"', async () => {
    const { agent, sent } = fakeAgent()
    const ran = jest.fn(async () => undefined)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 49 * 60_000 })
    lateStepStore.defer('conn-1', ran)
    ;(agent as any).modules.didcomm.basicMessages.sendMessage.mockRejectedValueOnce(new Error('no route'))
    await expect(askPeerReady(agent, 'conn-1')).rejects.toThrow('no route')
    expect(sent).toHaveLength(0)
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'held', dismissed: false })
    expect(lateStepStore.get('conn-1')?.check).toBeUndefined()
    // Asked again, it goes out, and its answer releases the hold as usual.
    await askPeerReady(agent, 'conn-1')
    const { checkId } = lateStepMessageOf(JSON.parse(sent[0].content)) as { checkId: string }
    await handleLateStepMessage(agent, 'conn-1', { kind: 'answer', checkId, ready: true })
    expect(ran).toHaveBeenCalledTimes(1)
  })

  it('a check sent while an older one fails is not rolled back by it', () => {
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 0 })
    lateStepStore.asked('conn-1', 'c2')
    lateStepStore.notAsked('conn-1', 'c1')
    expect(lateStepStore.get('conn-1')).toMatchObject({ phase: 'asking', check: { id: 'c2' } })
  })

  it('an answer that fails to send keeps the question on screen and releases nothing', async () => {
    const { agent, sent } = fakeAgent()
    const own = jest.fn(async () => undefined)
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: 62 * 60_000 })
    lateStepStore.defer('conn-1', own)
    await handleLateStepMessage(agent, 'conn-1', { kind: 'check', checkId: 'c9', waitedMs: 49 * 60_000 })
    ;(agent as any).modules.didcomm.basicMessages.sendMessage.mockRejectedValueOnce(new Error('no route'))
    await expect(answerPeerCheck(agent, 'conn-1', true)).rejects.toThrow('no route')
    expect(sent).toHaveLength(0)
    expect(lateStepStore.getAnyPeerCheck()).toMatchObject({ connectionId: 'conn-1', checkId: 'c9' })
    expect(own).not.toHaveBeenCalled()
    expect(lateStepStore.isHeld('conn-1')).toBe(true)
    // Tapped again, it goes.
    await answerPeerCheck(agent, 'conn-1', true)
    expect(lateStepMessageOf(JSON.parse(sent[0].content))).toEqual({ kind: 'answer', checkId: 'c9', ready: true })
    expect(lateStepStore.getAnyPeerCheck()).toBeUndefined()
    expect(own).toHaveBeenCalledTimes(1)
  })

  it('a newer check that arrives while an answer is sending stays on screen', async () => {
    const { agent, sent } = fakeAgent()
    await handleLateStepMessage(agent, 'conn-1', { kind: 'check', checkId: 'c9', waitedMs: 0 })
    ;(agent as any).modules.didcomm.basicMessages.sendMessage.mockImplementationOnce(
      async (connectionId: string, content: string) => {
        await handleLateStepMessage(agent, 'conn-1', { kind: 'check', checkId: 'c10', waitedMs: 0 })
        sent.push({ connectionId, content })
      }
    )
    await answerPeerCheck(agent, 'conn-1', false)
    expect(lateStepStore.getPeerCheck('conn-1')).toMatchObject({ checkId: 'c10' })
  })

  it('a stop, sent or received, ends the flow as cancelled and forgets the hold', async () => {
    const { agent, sent } = fakeAgent()
    vrcFlowStore.setStatus('conn-1', 'connecting')
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'connected', waitedMs: LATE_STEP_MS })
    await stopExchange(agent, 'conn-1')
    expect(lateStepMessageOf(JSON.parse(sent[0].content))).toEqual({ kind: 'stop' })
    expect(vrcFlowStore.getStatus('conn-1')).toBe('idle')
    expect(vrcFlowStore.flowEndedWith('conn-1')).toBe('cancelled')
    expect(lateStepStore.isHeld('conn-1')).toBe(false)

    vrcFlowStore.setStatus('conn-1', 'proposed')
    lateStepStore.hold({ connectionId: 'conn-1', reason: 'accepted', waitedMs: LATE_STEP_MS })
    await handleLateStepMessage(agent, 'conn-1', { kind: 'stop' })
    expect(vrcFlowStore.getStatus('conn-1')).toBe('idle')
    expect(lateStepStore.isHeld('conn-1')).toBe(false)
  })
})
