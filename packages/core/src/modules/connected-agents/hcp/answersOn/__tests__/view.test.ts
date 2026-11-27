/**
 * "Answers on" as a view model, against a fake VTA port, a fake clock and the real `HcpAnswersStore` over memory
 * records: the three states' views; on, then off, then on is refused before any call; the record is written only on
 * success, after an intent written before the send, which an unanswered or unrecorded directive leaves holding the
 * switch where the VTA may be (an Off locked); `operators` is the target's operator; every payload sent and answer given validates against the vendored
 * schema; and a `permit` is never sent after a `deny`, even when the two are asked for at once.
 */
import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { setAgentConnectEnabled } from '../../../agentConnectFlag'
import { CLIENT_VID, OTHER_VID } from '../../__tests__/fixtures/hcpApproval'
import { setHcpEnabled } from '../../hcpFlag'
import { HcpOffError, type HcpVtaPort } from '../../vtaPort'
import { HCP_DIRECTIVES_SET } from '../directive'
import { HcpAnswersStore } from '../store'
import { changeHcpAnswers, hcpAnswersView, loadHcpAnswersView, type HcpAnswersDeps } from '../view'
import { directiveAnswer, directiveSetSchemas, expectValid } from './fixtures/directiveSchema'

const S = directiveSetSchemas()
const OPERATOR = 'did:web:labs.example'
const NAME = 'My notes agent'
const NOW = '2026-11-27T12:00:00.000Z'

const refusal = (code: string) => Object.assign(new Error('refused'), { name: 'VtiRefusal', code })

type Answer = (payload: Record<string, unknown>, n: number) => unknown

/** A valid `directives/set` answer, the n-th directive set. */
function validAnswer(payload: Record<string, unknown>, n: number): Record<string, unknown> {
  const answer = directiveAnswer(payload, `urn:uuid:0000000${n}-0000-4000-8000-000000000000`)
  expectValid(S.response, answer)
  return answer
}

function setup(answer: Answer = validAnswer) {
  const genericRecords = memoryGenericRecords()
  const store = new HcpAnswersStore({ genericRecords } as unknown as Agent)
  const sent: Record<string, unknown>[] = []
  const port: HcpVtaPort = {
    task: jest.fn(async (type: string, payload: Record<string, unknown>) => {
      expect(type).toBe(HCP_DIRECTIVES_SET)
      expectValid(S.request, payload)
      sent.push(payload)
      const value = answer(payload, sent.length)
      if (value instanceof Error) throw value
      return value
    }),
  }
  const deps: HcpAnswersDeps = { port, store, clock: () => new Date(NOW) }
  return { deps, store, sent, port, genericRecords }
}

const target = (on: boolean, change: { connectionId?: string; operatorId?: string } = {}) => ({
  connectionId: CLIENT_VID,
  name: NAME,
  operatorId: OPERATOR,
  on,
  language: 'en' as const,
  ...change,
})

beforeEach(() => {
  setAgentConnectEnabled(true)
  setHcpEnabled(true)
})

afterEach(() => {
  setHcpEnabled(false)
  setAgentConnectEnabled(false)
})

describe('hcpAnswersView', () => {
  it('off: the switch off and enabled, the off help, and the plan’s turn-on confirmation with the directive text', () => {
    expect(hcpAnswersView('off', NAME)).toEqual({
      state: 'off',
      row: { key: 'AnswersRow' },
      value: { key: 'AnswersValueOff' },
      switch: { on: false, enabled: true },
      help: { key: 'AnswersHelpOff', params: { name: NAME } },
      confirm: {
        turn: 'on',
        title: { key: 'AnswersOnTitle', params: { name: NAME } },
        body: { key: 'AnswersOnBody' },
        directiveText: { key: 'AnswersOnDirectiveText' },
        confirm: { key: 'AnswersOnConfirm' },
        keep: { key: 'AnswersOnKeep' },
      },
    })
  })

  it('on: the switch on, the on help, and turning off asks first', () => {
    expect(hcpAnswersView('on', NAME)).toEqual({
      state: 'on',
      row: { key: 'AnswersRow' },
      value: { key: 'AnswersValueOn' },
      switch: { on: true, enabled: true },
      help: { key: 'AnswersHelpOn', params: { name: NAME } },
      confirm: {
        turn: 'off',
        title: { key: 'AnswersOffConfirm', params: { name: NAME } },
        directiveText: { key: 'AnswersOffDirectiveText' },
        confirm: { key: 'AnswersOffTurnOff' },
        keep: { key: 'AnswersOffKeep' },
      },
    })
  })

  it('offForGood: off, disabled, locked, and no confirmation to offer', () => {
    expect(hcpAnswersView('offForGood', NAME)).toEqual({
      state: 'offForGood',
      row: { key: 'AnswersRow' },
      value: { key: 'AnswersValueOff' },
      switch: { on: false, enabled: false },
      help: { key: 'AnswersLocked' },
    })
  })

  it('loadHcpAnswersView reads the store', async () => {
    const { store } = setup()
    await expect(
      loadHcpAnswersView(store, { connectionId: CLIENT_VID, name: NAME, operatorId: OPERATOR })
    ).resolves.toEqual(hcpAnswersView('off', NAME))
  })
})

describe('changeHcpAnswers', () => {
  it('on, then off, then on: the third is refused before any call, and the switch stays off for good', async () => {
    const { deps, sent, store } = setup()
    const on = await changeHcpAnswers(deps, target(true))
    expect(on).toEqual({ ok: true, view: hcpAnswersView('on', NAME), sent: true })
    const off = await changeHcpAnswers(deps, target(false))
    expect(off).toEqual({ ok: true, view: hcpAnswersView('offForGood', NAME), sent: true })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny'])

    const again = await changeHcpAnswers(deps, target(true))
    expect(again).toEqual({
      ok: false,
      locked: true,
      view: hcpAnswersView('offForGood', NAME),
      message: { key: 'AnswersLocked' },
    })
    expect(sent).toHaveLength(2)
    await expect(store.get(CLIENT_VID)).resolves.toEqual({
      id: CLIENT_VID,
      state: 'offForGood',
      directiveId: 'urn:uuid:00000002-0000-4000-8000-000000000000',
      setAt: NOW,
      operatorId: OPERATOR,
    })
  })

  it('operators is the target’s operator, in every directive sent', async () => {
    const { deps, sent } = setup()
    await changeHcpAnswers(deps, target(true))
    await changeHcpAnswers(deps, target(false))
    for (const payload of sent) expect(payload.operators).toEqual([OPERATOR])
  })

  it('a change to the state it is already in sends nothing and writes nothing', async () => {
    const { deps, sent, genericRecords } = setup()
    await expect(changeHcpAnswers(deps, target(false))).resolves.toEqual({
      ok: true,
      view: hcpAnswersView('off', NAME),
      sent: false,
    })
    await changeHcpAnswers(deps, target(true))
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: true, sent: false })
    await changeHcpAnswers(deps, target(false))
    await expect(changeHcpAnswers(deps, target(false))).resolves.toMatchObject({ ok: true, sent: false })
    expect(sent).toHaveLength(2)
    expect(genericRecords.records).toHaveLength(1)
  })

  it('a refusal writes nothing and gives the refusal key, which offers no retry', async () => {
    const { deps, store } = setup(() => refusal('permissionDenied'))
    await expect(changeHcpAnswers(deps, target(true))).resolves.toEqual({
      ok: false,
      refused: 'permissionDenied',
      view: hcpAnswersView('off', NAME),
      message: { key: 'AnswersRefused' },
    })
    await expect(store.get(CLIENT_VID)).resolves.toBeUndefined()
    await expect(store.listIntents()).resolves.toEqual([])
  })

  it('an unreachable VTA records nothing but keeps the intent: a failed Off reads off for good, unconfirmed', async () => {
    let fail = false
    const { deps, store, sent } = setup((payload, n) => (fail ? new Error('timeout') : validAnswer(payload, n)))
    await changeHcpAnswers(deps, target(true))
    fail = true
    await expect(changeHcpAnswers(deps, target(false))).resolves.toEqual({
      ok: false,
      unreachable: true,
      view: hcpAnswersView('offForGood', NAME, { on: false }),
      message: { key: 'AnswersUnreachable' },
    })
    await expect(store.get(CLIENT_VID)).resolves.toMatchObject({ state: 'on' })
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('offForGood')
    // The deny may hold: no permit follows it.
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: false, locked: true })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny'])
  })

  it('a success with no directiveId is recorded, so an Off still locks the switch', async () => {
    const { deps, store, sent } = setup(() => ({}))
    await changeHcpAnswers(deps, target(false))
    expect(sent).toHaveLength(0)
    await changeHcpAnswers(deps, target(true))
    await changeHcpAnswers(deps, target(false))
    await expect(store.get(CLIENT_VID)).resolves.toMatchObject({ state: 'offForGood', directiveId: null })
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: false, locked: true })
  })

  it('a deny through one connection locks the operator’s other connections too', async () => {
    const { deps, sent } = setup()
    await changeHcpAnswers(deps, target(true, { connectionId: OTHER_VID }))
    await changeHcpAnswers(deps, target(false, { connectionId: OTHER_VID }))
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: false, locked: true })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny'])
  })

  it('the intent is written before the directive is sent, and removed once it is recorded', async () => {
    const { deps, store, port } = setup()
    const seen: unknown[] = []
    const answer = port.task as jest.Mock
    const inner = answer.getMockImplementation()!
    answer.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      seen.push(await store.listIntents())
      return inner(type, payload)
    })
    await changeHcpAnswers(deps, target(false))
    await changeHcpAnswers(deps, target(true))
    await changeHcpAnswers(deps, target(false))
    expect(seen).toEqual([
      [{ id: CLIENT_VID, operatorId: OPERATOR, on: true, startedAt: NOW }],
      [{ id: CLIENT_VID, operatorId: OPERATOR, on: false, startedAt: NOW }],
    ])
    await expect(store.listIntents()).resolves.toEqual([])
  })

  it('an intent that cannot be written sends nothing', async () => {
    const { deps, store, port } = setup()
    jest.spyOn(store, 'putIntent').mockRejectedValueOnce(new Error('disk full'))
    await expect(changeHcpAnswers(deps, target(true))).resolves.toEqual({
      ok: false,
      notSaved: true,
      view: hcpAnswersView('off', NAME),
      message: { key: 'AnswersNotSaved' },
    })
    expect(port.task).not.toHaveBeenCalled()
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('off')
  })

  // The review of #1106: a successful Off whose record write fails must not leave the switch on and enabled.
  it('a successful Off whose record cannot be written still reads off for good, and no permit follows', async () => {
    const { deps, store, sent } = setup()
    await changeHcpAnswers(deps, target(true))
    jest.spyOn(store, 'put').mockRejectedValueOnce(new Error('disk full'))
    await expect(changeHcpAnswers(deps, target(false))).resolves.toEqual({
      ok: true,
      view: hcpAnswersView('offForGood', NAME),
      sent: true,
      notRecorded: true,
    })
    const after = await loadHcpAnswersView(store, { connectionId: CLIENT_VID, name: NAME, operatorId: OPERATOR })
    expect(after.state).toBe('offForGood')
    expect(after.switch).toEqual({ on: false, enabled: false })
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: false, locked: true })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny'])
  })

  it('the app stopping after the send, before the record: the intent alone reads off for good', async () => {
    const { deps, store, sent, genericRecords } = setup()
    await changeHcpAnswers(deps, target(true))
    // As if the app stopped between the send and `complete`: `complete` is held, and the store read afresh meanwhile.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    jest.spyOn(store, 'complete').mockImplementationOnce(() => held)
    const change = changeHcpAnswers(deps, target(false))
    while (sent.length < 2) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny'])
    const restarted = new HcpAnswersStore({ genericRecords } as unknown as Agent)
    await expect(restarted.state(CLIENT_VID, OPERATOR)).resolves.toBe('offForGood')
    await expect(restarted.read(CLIENT_VID, OPERATOR)).resolves.toMatchObject({ intent: { on: false } })
    release()
    await change
  })

  it('an unconfirmed Off is sent again on request, and settles once the VTA answers', async () => {
    let fail = false
    const { deps, store, sent } = setup((payload, n) => (fail ? new Error('timeout') : validAnswer(payload, n)))
    await changeHcpAnswers(deps, target(true))
    fail = true
    await changeHcpAnswers(deps, target(false))
    fail = false
    await expect(changeHcpAnswers(deps, target(false))).resolves.toEqual({
      ok: true,
      view: hcpAnswersView('offForGood', NAME),
      sent: true,
    })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny', 'deny'])
    await expect(store.listIntents()).resolves.toEqual([])
    await expect(store.get(CLIENT_VID)).resolves.toMatchObject({ state: 'offForGood' })
    // Settled: a further Off sends nothing.
    await expect(changeHcpAnswers(deps, target(false))).resolves.toMatchObject({ ok: true, sent: false })
  })

  it('an unconfirmed On reads on, so the Off that overrides it stays offered, and can be sent again', async () => {
    let fail = true
    const { deps, store, sent } = setup((payload, n) => (fail ? new Error('timeout') : validAnswer(payload, n)))
    await expect(changeHcpAnswers(deps, target(true))).resolves.toEqual({
      ok: false,
      unreachable: true,
      view: hcpAnswersView('on', NAME, { on: true }),
      message: { key: 'AnswersUnreachable' },
    })
    expect(hcpAnswersView('on', NAME, { on: true }).confirm).toMatchObject({ turn: 'off' })
    fail = false
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: true, sent: true })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'permit'])
    await expect(
      loadHcpAnswersView(store, { connectionId: CLIENT_VID, name: NAME, operatorId: OPERATOR })
    ).resolves.toEqual(hcpAnswersView('on', NAME))
  })

  it('a refused Off after an unconfirmed On puts the On’s intent back: its permit may still hold', async () => {
    const answers: Answer[] = [() => new Error('timeout'), () => refusal('permissionDenied')]
    const { deps, store } = setup((payload, n) => answers[n - 1](payload, n))
    await changeHcpAnswers(deps, target(true))
    await expect(changeHcpAnswers(deps, target(false))).resolves.toMatchObject({
      ok: false,
      refused: 'permissionDenied',
    })
    await expect(store.read(CLIENT_VID, OPERATOR)).resolves.toMatchObject({ state: 'on', intent: { on: true } })
  })

  it('an unconfirmed Off through one connection locks the operator’s other connections', async () => {
    let fail = false
    const { deps, sent } = setup((payload, n) => (fail ? new Error('timeout') : validAnswer(payload, n)))
    await changeHcpAnswers(deps, target(true, { connectionId: OTHER_VID }))
    fail = true
    await changeHcpAnswers(deps, target(false, { connectionId: OTHER_VID }))
    await expect(changeHcpAnswers(deps, target(true))).resolves.toMatchObject({ ok: false, locked: true })
    expect(sent.map((p) => p.effect)).toEqual(['permit', 'deny'])
  })

  it('with the HCP flags off, nothing is read or sent', async () => {
    setHcpEnabled(false)
    const { deps, port, genericRecords } = setup()
    await expect(changeHcpAnswers(deps, target(true))).resolves.toEqual({ ok: false, off: true })
    expect(port.task).not.toHaveBeenCalled()
    expect(genericRecords.findAllByQuery).not.toHaveBeenCalled()
  })

  it('the port finding the flags off mid-change gives off and writes nothing', async () => {
    const { deps, store } = setup(() => new HcpOffError())
    await expect(changeHcpAnswers(deps, target(true))).resolves.toEqual({ ok: false, off: true })
    await expect(store.get(CLIENT_VID)).resolves.toBeUndefined()
    await expect(store.listIntents()).resolves.toEqual([])
  })

  // control: the brief's control, a permit sent after a deny is never produced.
  it('control: a permit is never sent after a deny, even when Off and On are asked for at once', async () => {
    const { deps, sent } = setup()
    await changeHcpAnswers(deps, target(true))
    const [off, on] = await Promise.all([changeHcpAnswers(deps, target(false)), changeHcpAnswers(deps, target(true))])
    expect(off).toMatchObject({ ok: true, sent: true })
    expect(on).toMatchObject({ ok: false, locked: true })
    // Two connections of one operator, at once: the deny wins and no permit follows it.
    await Promise.all([
      changeHcpAnswers(deps, target(false, { connectionId: OTHER_VID })),
      changeHcpAnswers(deps, target(true, { connectionId: OTHER_VID })),
    ])
    const effects = sent.map((p) => p.effect)
    expect(effects).toEqual(['permit', 'deny'])
    expect(effects.slice(effects.indexOf('deny'))).not.toContain('permit')
  })
})
