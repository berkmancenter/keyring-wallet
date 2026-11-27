/**
 * "Answers on" on an HCP agent (step 7.29, C5), as a view model: copy keys and parameters, never formatted text, with
 * times as ISO-8601 instants. No screen, route or testID: the views come later, behind the flags.
 *
 * - {@link hcpAnswersView}: the row, its value, the switch, the help line and the confirmation to show before a change.
 *   `off` and `on` each confirm first (Off because it cannot be undone in P1); `offForGood` shows off, disabled, with
 *   `AnswersLocked`, and offers no change.
 * - {@link changeHcpAnswers}: turn the switch on or off. Turning on after a `deny` is refused here, before any call:
 *   a `permit` is never sent after a `deny` for the same operator. A change to the state it is already in sends
 *   nothing. The record is written only after the VTA answered success.
 *
 * @module connected-agents/hcp/answersOn/view
 */
import type { HcpCopyLanguage } from '../copy'
import { isHcpEnabled } from '../hcpFlag'
import { type HcpVtaPort, onHcpFailure } from '../vtaPort'
import { setHcpAnswers } from './directive'
import type { HcpAnswersRecord, HcpAnswersState, HcpAnswersStore } from './store'

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
}

/** The view model for a connection named `name` in `state`. */
export function hcpAnswersView(state: HcpAnswersState, name: string): HcpAnswersView {
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
  store: Pick<HcpAnswersStore, 'state'>,
  target: HcpAnswersTarget
): Promise<HcpAnswersView> {
  return hcpAnswersView(await store.state(target.connectionId, target.operatorId), target.name)
}

export interface HcpAnswersDeps {
  port: HcpVtaPort
  store: Pick<HcpAnswersStore, 'state' | 'put' | 'locked'>
  clock: () => Date
}

export type HcpAnswersChange =
  /** `sent`: whether a directive was set (false when the switch was already in the state asked for). */
  | { ok: true; view: HcpAnswersView; sent: boolean }
  /** Turning on after a `deny`: refused before any call. */
  | { ok: false; locked: true; view: HcpAnswersView; message: { key: 'AnswersLocked' } }
  | { ok: false; refused: string; view: HcpAnswersView; message: { key: 'AnswersRefused' } }
  | { ok: false; unreachable: true; view: HcpAnswersView; message: { key: 'AnswersUnreachable' } }
  /**
   * The HCP flags are off: nothing was read or sent. No copy, as in `../revoke.ts`: with the flags off no screen that
   * shows the switch is reachable.
   */
  | { ok: false; off: true }

/**
 * Turn "Answers on" on or off for one connection, after the person confirmed (`view.confirm`). Read, send and write
 * happen as one step under the operator's lock (`HcpAnswersStore.locked`).
 */
export async function changeHcpAnswers(
  deps: HcpAnswersDeps,
  target: HcpAnswersTarget & { on: boolean; language: HcpCopyLanguage }
): Promise<HcpAnswersChange> {
  if (!isHcpEnabled()) return { ok: false, off: true }
  const { connectionId, name, operatorId, on, language } = target
  return deps.store.locked(operatorId, async (): Promise<HcpAnswersChange> => {
    const state = await deps.store.state(connectionId, operatorId)
    const view = hcpAnswersView(state, name)
    if (on && state === 'offForGood') return { ok: false, locked: true, view, message: { key: 'AnswersLocked' } }
    // Already on, or not on (off, or off for good) when asked to turn off: nothing to send.
    if (on === (state === 'on')) return { ok: true, view, sent: false }

    const result = await setHcpAnswers(deps.port, { operatorId, on, language })
    if (!result.ok) {
      return onHcpFailure<HcpAnswersChange>(result, {
        refused: (code) => ({ ok: false, refused: code, view, message: { key: 'AnswersRefused' } }),
        unreachable: () => ({ ok: false, unreachable: true, view, message: { key: 'AnswersUnreachable' } }),
        off: () => ({ ok: false, off: true }),
      })
    }
    const record: HcpAnswersRecord = {
      id: connectionId,
      state: on ? 'on' : 'offForGood',
      directiveId: result.directiveId,
      setAt: deps.clock().toISOString(),
      operatorId,
    }
    await deps.store.put(record)
    return { ok: true, view: hcpAnswersView(record.state, name), sent: true }
  })
}
