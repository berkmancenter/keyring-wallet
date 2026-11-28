/**
 * "Answers on" on an HCP agent (step 7.29, C5), as a view model: copy keys and parameters, never formatted text, with
 * times as ISO-8601 instants. No screen, route or testID: the views come later, behind the flags.
 *
 * - {@link hcpAnswersView}: the row, its value, the switch, the help line and the confirmation to show before a change.
 *   `off` and `on` each confirm first (Off because it cannot be undone in P1); `offForGood` shows off, disabled, with
 *   `AnswersLocked`, and offers no change. `unconfirmed` names a directive sent with no answer known.
 * - {@link changeHcpAnswers}: turn the switch on or off. Turning on after a `deny` is refused here, before any call:
 *   a `permit` is never sent after a `deny` for the same operator. A change to the state it is already in sends
 *   nothing, unless the directive for it was sent with no answer known, which is sent again. A directive cannot be
 *   undone or read back in P1, so an intent is written before it is sent and settled after (`./store.ts`): the
 *   record is written only after the VTA answered success, and until then the intent holds the switch where the VTA
 *   may be (an Off locked, an On on).
 *
 * @module connected-agents/hcp/answersOn/view
 */
import type { HcpCopyLanguage } from '../copy'
import { isHcpEnabled } from '../hcpFlag'
import { type HcpVtaPort, onHcpFailure } from '../vtaPort'
import { setHcpAnswers } from './directive'
import type { HcpAnswersIntent, HcpAnswersRecord, HcpAnswersState, HcpAnswersStore } from './store'

/** The confirmation shown before a change, with the directive's `text` (HCP: shown to the person when it is set). */
export type HcpAnswersConfirm =
  | {
      turn: 'on'
      title: { key: 'AnswersOnTitle'; params: { name: string } }
      body: { key: 'AnswersOnBody' }
      directiveText: { key: 'AnswersOnDirectiveText' }
      confirm: { key: 'AnswersOnConfirm' }
      keep: { key: 'AnswersOnKeep' }
    }
  | {
      turn: 'off'
      title: { key: 'AnswersOffConfirm'; params: { name: string } }
      directiveText: { key: 'AnswersOffDirectiveText' }
      confirm: { key: 'AnswersOffTurnOff' }
      keep: { key: 'AnswersOffKeep' }
    }

export type HcpAnswersView = {
  state: HcpAnswersState
  row: { key: 'AnswersRow' }
  value: { key: 'AnswersValueOff' } | { key: 'AnswersValueOn' }
  /** `enabled` is false only for `offForGood`. */
  switch: { on: boolean; enabled: boolean }
  help:
    | { key: 'AnswersHelpOff'; params: { name: string } }
    | { key: 'AnswersHelpOn'; params: { name: string } }
    | { key: 'AnswersLocked' }
  /** What a tap on the switch asks first; absent when the switch is disabled. */
  confirm?: HcpAnswersConfirm
  /**
   * Present when a directive for this connection was sent and its answer is not known (the VTA was unreachable, or
   * the app stopped before recording it): `state` already reads as if it had been set. `changeHcpAnswers` with the
   * same `turn` sends it again, even when the switch is disabled.
   */
  unconfirmed?: { turn: 'on' | 'off'; message: { key: 'AnswersUnreachable' } }
}

/**
 * The view model for a connection named `name` in `state`, with `intent` the connection's directive sent with no
 * answer known, if any (`HcpAnswersStore.read`).
 */
export function hcpAnswersView(
  state: HcpAnswersState,
  name: string,
  intent?: Pick<HcpAnswersIntent, 'on'>
): HcpAnswersView {
  const view = stateView(state, name)
  if (!intent) return view
  return { ...view, unconfirmed: { turn: intent.on ? 'on' : 'off', message: { key: 'AnswersUnreachable' } } }
}

function stateView(state: HcpAnswersState, name: string): HcpAnswersView {
  const row = { key: 'AnswersRow' } as const
  if (state === 'on') {
    return {
      state,
      row,
      value: { key: 'AnswersValueOn' },
      switch: { on: true, enabled: true },
      help: { key: 'AnswersHelpOn', params: { name } },
      confirm: {
        turn: 'off',
        title: { key: 'AnswersOffConfirm', params: { name } },
        directiveText: { key: 'AnswersOffDirectiveText' },
        confirm: { key: 'AnswersOffTurnOff' },
        keep: { key: 'AnswersOffKeep' },
      },
    }
  }
  if (state === 'offForGood') {
    return {
      state,
      row,
      value: { key: 'AnswersValueOff' },
      switch: { on: false, enabled: false },
      help: { key: 'AnswersLocked' },
    }
  }
  return {
    state,
    row,
    value: { key: 'AnswersValueOff' },
    switch: { on: false, enabled: true },
    help: { key: 'AnswersHelpOff', params: { name } },
    confirm: {
      turn: 'on',
      title: { key: 'AnswersOnTitle', params: { name } },
      body: { key: 'AnswersOnBody' },
      directiveText: { key: 'AnswersOnDirectiveText' },
      confirm: { key: 'AnswersOnConfirm' },
      keep: { key: 'AnswersOnKeep' },
    },
  }
}

/** Which connection, and the grant's Client Operator id (the `hcpGrantClient` effect's `operator.id`). */
export interface HcpAnswersTarget {
  /** The connection's `id`, the client's VID. */
  connectionId: string
  /** The name the person gave. */
  name: string
  operatorId: string
}

/** The view model as the store has it now. */
export async function loadHcpAnswersView(
  store: Pick<HcpAnswersStore, 'read'>,
  target: HcpAnswersTarget
): Promise<HcpAnswersView> {
  const { state, intent } = await store.read(target.connectionId, target.operatorId)
  return hcpAnswersView(state, target.name, intent)
}

export interface HcpAnswersDeps {
  port: HcpVtaPort
  store: Pick<HcpAnswersStore, 'read' | 'putIntent' | 'removeIntent' | 'complete' | 'locked'>
  clock: () => Date
}

export type HcpAnswersChange =
  /**
   * `sent`: whether a directive was set (false when the switch was already in the state asked for). `notRecorded`:
   * the VTA set it but the record could not be written; the intent written before the send stays and reads the same
   * state, so the switch still shows what the VTA holds.
   */
  | { ok: true; view: HcpAnswersView; sent: boolean; notRecorded?: true }
  /** Turning on after a `deny`: refused before any call. */
  | { ok: false; locked: true; view: HcpAnswersView; message: { key: 'AnswersLocked' } }
  /** The intent could not be written, so nothing was sent. */
  | { ok: false; notSaved: true; view: HcpAnswersView; message: { key: 'AnswersNotSaved' } }
  | { ok: false; refused: string; view: HcpAnswersView; message: { key: 'AnswersRefused' } }
  /**
   * No answer from the VTA: the directive may have been set, so its intent stays, and `view` reads as if it had been
   * (an Off locked, an On on), with `unconfirmed`.
   */
  | { ok: false; unreachable: true; view: HcpAnswersView; message: { key: 'AnswersUnreachable' } }
  /**
   * The HCP flags are off: nothing was read or sent. No copy, as in `../revoke.ts`: with the flags off no screen that
   * shows the switch is reachable.
   */
  | { ok: false; off: true }

/**
 * Turn "Answers on" on or off for one connection, after the person confirmed (`view.confirm`), or send again a
 * directive left unconfirmed (`view.unconfirmed`). Read, intent, send and record happen as one step under the
 * operator's lock (`HcpAnswersStore.locked`):
 *
 * 1. the intent is written; if that fails, nothing is sent (`notSaved`);
 * 2. the directive is sent, once;
 * 3. on success, the record is written and the intent removed (`HcpAnswersStore.complete`); if that fails, the intent
 *    stays and reads the same state (`notRecorded`). On a refusal, or the flags found off, the directive was not set:
 *    the intent is removed, or the connection's earlier unconfirmed intent put back, since what that one sent may
 *    still have been set. With no answer, the intent stays (`unreachable`).
 */
export async function changeHcpAnswers(
  deps: HcpAnswersDeps,
  target: HcpAnswersTarget & { on: boolean; language: HcpCopyLanguage }
): Promise<HcpAnswersChange> {
  if (!isHcpEnabled()) return { ok: false, off: true }
  const { connectionId, name, operatorId, on, language } = target
  return deps.store.locked(operatorId, async (): Promise<HcpAnswersChange> => {
    const { state, intent: earlier } = await deps.store.read(connectionId, operatorId)
    const view = hcpAnswersView(state, name, earlier)
    if (on && state === 'offForGood') return { ok: false, locked: true, view, message: { key: 'AnswersLocked' } }
    // Already on, or not on (off, or off for good) when asked to turn off: nothing to send, unless the directive
    // for that was sent with no answer known, which is sent again.
    const resend = earlier?.on === on
    if (!resend && on === (state === 'on')) return { ok: true, view, sent: false }

    const intent: HcpAnswersIntent = { id: connectionId, operatorId, on, startedAt: deps.clock().toISOString() }
    try {
      await deps.store.putIntent(intent)
    } catch {
      return { ok: false, notSaved: true, view, message: { key: 'AnswersNotSaved' } }
    }

    const result = await setHcpAnswers(deps.port, { operatorId, on, language })
    if (!result.ok) {
      const notSet = async (): Promise<void> => {
        if (earlier) await deps.store.putIntent(earlier)
        else await deps.store.removeIntent(connectionId)
      }
      return onHcpFailure<Promise<HcpAnswersChange>>(result, {
        refused: async (code) => {
          await notSet()
          return { ok: false, refused: code, view, message: { key: 'AnswersRefused' } }
        },
        unreachable: async () => {
          const now = await deps.store.read(connectionId, operatorId)
          return {
            ok: false,
            unreachable: true,
            view: hcpAnswersView(now.state, name, now.intent),
            message: { key: 'AnswersUnreachable' },
          }
        },
        off: async () => {
          await notSet()
          return { ok: false, off: true }
        },
      })
    }
    const record: HcpAnswersRecord = {
      id: connectionId,
      state: on ? 'on' : 'offForGood',
      directiveId: result.directiveId,
      setAt: deps.clock().toISOString(),
      operatorId,
    }
    const done = { ok: true, view: hcpAnswersView(record.state, name), sent: true } as const
    try {
      await deps.store.complete(record)
    } catch {
      return { ...done, notRecorded: true }
    }
    return done
  })
}
