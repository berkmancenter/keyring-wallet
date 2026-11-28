/**
 * Agent connect, the HCP agent list, its notice lines and the HCP Revoke sheet as views (backlog Section C, U2; canvas
 * frames 52, 54, 55). Views only: nothing here reads the store or revokes.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import path from 'path'
import React from 'react'
import { ActivityIndicator } from 'react-native'

import { BasicAppContext } from '../../../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../../../utils/testable'
import {
  formatSampleTime,
  HCP_CONNECTED,
  HCP_EXPIRED,
  HCP_LIST_NOW,
  HCP_REVOKED,
} from '../../../__tests__/fixtures/screenStatesHcpList'
import { hcpText } from '../../copy'
import type { HcpRevokeResult } from '../../revoke'
import type { HcpNoticeLine as HcpNoticeLineData } from '../../status'
import type { HcpConnection } from '../../types'
import HcpAgentListView, { HcpAgentListViewProps } from '../HcpAgentListView'
import HcpNoticeLine from '../HcpNoticeLine'
import HcpRevokeSheet, { HcpRevokeSheetProps } from '../HcpRevokeSheet'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const en = (key: Parameters<typeof hcpText>[0], params?: Record<string, string>) => hcpText(key, 'en', params)
/** A time format the test can tell from the fixture's, so a line that skips `formatTime` shows. */
const formatTime = (iso: string) => `at ${iso.slice(11, 16)}`

describe('HcpNoticeLine', () => {
  it.each<[string, HcpNoticeLineData, string]>([
    [
      'telling',
      { key: 'RevokeTelling', params: { name: 'Notes helper' } },
      en('RevokeTelling', { name: 'Notes helper' }),
    ],
    [
      'told',
      { key: 'RevokeTold', params: { name: 'Notes helper', time: '2026-11-27T14:02:00.000Z' } },
      en('RevokeTold', { name: 'Notes helper', time: 'at 14:02' }),
    ],
    [
      'not told',
      { key: 'RevokeNotTold', params: { name: 'Notes helper', time: '2026-11-27T14:17:00.000Z' } },
      en('RevokeNotTold', { name: 'Notes helper', time: 'at 14:17' }),
    ],
    ['nothing disclosed', { key: 'RevokeNothingDisclosed' }, en('RevokeNothingDisclosed')],
  ])('%s draws its line, with the time formatted', (_, line, words) => {
    const tree = show(<HcpNoticeLine line={line} formatTime={formatTime} />)
    expect(tree.getByText(words)).toBeTruthy()
    expect(tree.getByTestId(id('HcpNoticeLine')).props.accessibilityLabel).toBe(words)
  })

  // control: the raw instant never reaches the screen.
  it('control: never shows the ISO instant', () => {
    const line: HcpNoticeLineData = {
      key: 'RevokeTold',
      params: { name: 'Notes helper', time: '2026-11-27T14:02:00.000Z' },
    }
    const tree = show(<HcpNoticeLine line={line} formatTime={formatTime} />)
    expect(tree.queryByText(/2026-11-27T/)).toBeNull()
  })
})

describe('HcpAgentListView', () => {
  const list = (over: Partial<HcpAgentListViewProps> = {}) => {
    const props: HcpAgentListViewProps = {
      connections: [HCP_CONNECTED, HCP_EXPIRED],
      now: HCP_LIST_NOW,
      formatTime,
      onOpen: jest.fn(),
      onRevoke: jest.fn(),
      onConnect: jest.fn(),
      ...over,
    }
    return { props, tree: show(<HcpAgentListView {...props} />) }
  }

  it("draws one card per connection, with its name and hcpStatus's words", () => {
    const { tree } = list()
    expect(tree.getAllByTestId(id('HcpAgentRow'))).toHaveLength(2)
    expect(tree.getByText('Notes helper')).toBeTruthy()
    expect(tree.getByText(en('StatusConnectedUntil', { time: 'at 14:30' }))).toBeTruthy()
    expect(tree.getByText('Travel agent')).toBeTruthy()
    expect(tree.getByText(en('StatusExpired'))).toBeTruthy()
  })

  it.each<[string, HcpConnection, string, string | undefined]>([
    ['connected', HCP_CONNECTED, en('StatusConnectedUntil', { time: 'at 14:30' }), undefined],
    ['expired', HCP_EXPIRED, en('StatusExpired'), undefined],
    ['revoked, telling', HCP_REVOKED.telling, en('StatusRevoked'), en('RevokeTelling', { name: 'Notes helper' })],
    [
      'revoked, told',
      HCP_REVOKED.told,
      en('StatusRevoked'),
      en('RevokeTold', { name: 'Notes helper', time: 'at 14:02' }),
    ],
    [
      'revoked, not told',
      HCP_REVOKED.notTold,
      en('StatusRevoked'),
      en('RevokeNotTold', { name: 'Notes helper', time: 'at 14:17' }),
    ],
  ])('a %s row shows its status, and a revoked one its notice line', (_, connection, status, notice) => {
    const { tree } = list({ connections: [connection] })
    expect(tree.getByText(status)).toBeTruthy()
    if (notice) {
      expect(tree.getByTestId(id('HcpNoticeLine')).props.accessibilityLabel).toBe(notice)
    } else {
      expect(tree.queryByTestId(id('HcpNoticeLine'))).toBeNull()
    }
  })

  it('a revoked row reads revoked even past its end, and a row at its end reads expired', () => {
    const { tree } = list({
      connections: [HCP_REVOKED.told, { ...HCP_CONNECTED, id: 'did:key:z6MkOther', name: 'Other' }],
      now: new Date(HCP_CONNECTED.expiresAt),
    })
    expect(tree.getByText(en('StatusRevoked'))).toBeTruthy()
    expect(tree.getByText(en('StatusExpired'))).toBeTruthy()
  })

  it('Revoke shows on a connected row only, and calls back with its id', () => {
    const { props, tree } = list({ connections: [HCP_EXPIRED, HCP_CONNECTED, HCP_REVOKED.telling] })
    const revoke = tree.getAllByTestId(id('HcpAgentRowRevoke'))
    expect(revoke).toHaveLength(1)
    expect(revoke[0].props.accessibilityLabel).toBe(`${en('Revoke')}, Notes helper`)
    fireEvent.press(revoke[0])
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
    expect(props.onRevoke).toHaveBeenCalledWith(HCP_CONNECTED.id)
  })

  it('no Revoke without a handler, even on a connected row', () => {
    const { tree } = list({ connections: [HCP_CONNECTED], onRevoke: undefined })
    expect(tree.queryByTestId(id('HcpAgentRowRevoke'))).toBeNull()
  })

  // control: the same connection, revoked, loses its Revoke; and connected, it has one.
  it('control: a revoked row has no Revoke', () => {
    expect(list({ connections: [HCP_CONNECTED] }).tree.queryAllByTestId(id('HcpAgentRowRevoke'))).toHaveLength(1)
    for (const revoked of Object.values(HCP_REVOKED)) {
      expect(list({ connections: [revoked] }).tree.queryByTestId(id('HcpAgentRowRevoke'))).toBeNull()
    }
  })

  it('a tap on a card opens it; "Connect an agent" connects', () => {
    const { props, tree } = list()
    fireEvent.press(tree.getByLabelText('Travel agent, Rooms.AgentBadge'))
    expect(props.onOpen).toHaveBeenCalledWith(HCP_EXPIRED.id)
    const connect = tree.getByTestId(id('HcpAgentListConnect'))
    expect(connect.props.accessibilityLabel).toBe('ConnectedAgents.ConnectAnAgent')
    fireEvent.press(connect)
    expect(props.onConnect).toHaveBeenCalledTimes(1)
  })

  it('while the connections are read: a spinner, no rows, and still "Connect an agent"', () => {
    const { tree } = list({ connections: undefined })
    expect(tree.UNSAFE_getByType(ActivityIndicator)).toBeTruthy()
    expect(tree.queryByTestId(id('HcpAgentRow'))).toBeNull()
    expect(tree.getByTestId(id('HcpAgentListConnect'))).toBeTruthy()
  })

  it('with the fixtures\' format, the frame\'s "Connected until 14:30"', () => {
    const { tree } = list({ formatTime: formatSampleTime })
    expect(tree.getByText('Connected until 14:30')).toBeTruthy()
  })
})

describe('HcpRevokeSheet', () => {
  const unreachable: HcpRevokeResult = {
    ok: false,
    unreachable: true,
    message: { key: 'RevokeUnreachable', params: { name: 'Notes helper' } },
  }
  const refused: HcpRevokeResult = {
    ok: false,
    refused: 'notFound',
    message: { key: 'RevokeRefused', params: { name: 'Notes helper' } },
  }
  const sheet = (onRevoke: HcpRevokeSheetProps['onRevoke']) => {
    const props: HcpRevokeSheetProps = {
      name: 'Notes helper',
      onRevoke: jest.fn(onRevoke),
      onKeep: jest.fn(),
      onDone: jest.fn(),
    }
    return { props, tree: show(<HcpRevokeSheet {...props} />) }
  }
  const press = (tree: ReturnType<typeof show>) => fireEvent.press(tree.getByTestId(id('HcpRevokeConfirm')))
  const disabled = (tree: ReturnType<typeof show>, key: string) =>
    tree.getByTestId(id(key)).props.accessibilityState.disabled

  it('draws the title, the body, Revoke and Keep, and no outcome', () => {
    const { tree } = sheet(async () => ({ ok: false, missing: true }))
    expect(tree.getByText(en('RevokeTitle', { name: 'Notes helper' }))).toBeTruthy()
    expect(tree.getByText(en('RevokeBody'))).toBeTruthy()
    expect(tree.getByTestId(id('HcpRevokeConfirm')).props.accessibilityLabel).toBe(en('Revoke'))
    expect(tree.getByTestId(id('HcpRevokeKeep')).props.accessibilityLabel).toBe(en('Keep'))
    expect(tree.queryByTestId(id('HcpRevokeOutcome'))).toBeNull()
  })

  it('Keep closes, and revokes nothing', () => {
    const { props, tree } = sheet(async () => ({ ok: true, connection: HCP_REVOKED.telling }))
    fireEvent.press(tree.getByTestId(id('HcpRevokeKeep')))
    expect(props.onKeep).toHaveBeenCalledTimes(1)
    expect(props.onRevoke).not.toHaveBeenCalled()
  })

  it('ok: calls onDone once, and the sheet is spent', async () => {
    const { props, tree } = sheet(async () => ({ ok: true, connection: HCP_REVOKED.telling }))
    press(tree)
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1))
    expect(tree.queryByTestId(id('HcpRevokeOutcome'))).toBeNull()
    expect(disabled(tree, 'HcpRevokeConfirm')).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
    expect(props.onDone).toHaveBeenCalledTimes(1)
  })

  it("unreachable: shows the result's line, and Revoke is there to press again", async () => {
    const { props, tree } = sheet(async () => unreachable)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpRevokeOutcome'))).toBeTruthy())
    expect(tree.getByTestId(id('HcpRevokeOutcome')).props.accessibilityLabel).toBe(
      en('RevokeUnreachable', { name: 'Notes helper' })
    )
    expect(props.onDone).not.toHaveBeenCalled()
    expect(disabled(tree, 'HcpRevokeConfirm')).toBe(false)
    press(tree)
    await waitFor(() => expect(props.onRevoke).toHaveBeenCalledTimes(2))
  })

  it("refused: shows the result's own RevokeRefused line, not FailGeneric, and the sheet is spent", async () => {
    const { props, tree } = sheet(async () => refused)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpRevokeOutcome'))).toBeTruthy())
    expect(tree.getByTestId(id('HcpRevokeOutcome')).props.accessibilityLabel).toBe(
      en('RevokeRefused', { name: 'Notes helper' })
    )
    expect(tree.queryByText('ConnectedAgents.FailGeneric')).toBeNull()
    expect(tree.queryByText(/notFound/)).toBeNull()
    expect(props.onDone).not.toHaveBeenCalled()
    // A refusal repeats: Revoke is spent, and a press sends nothing. Keep still closes the sheet.
    expect(disabled(tree, 'HcpRevokeConfirm')).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
    expect(disabled(tree, 'HcpRevokeKeep')).toBe(false)
    fireEvent.press(tree.getByTestId(id('HcpRevokeKeep')))
    expect(props.onKeep).toHaveBeenCalledTimes(1)
  })

  it('missing: calls onDone once and closes with no line, and Revoke stays disabled', async () => {
    const { props, tree } = sheet(async () => ({ ok: false, missing: true }))
    press(tree)
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1))
    expect(tree.queryByTestId(id('HcpRevokeOutcome'))).toBeNull()
    expect(disabled(tree, 'HcpRevokeConfirm')).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
    expect(props.onDone).toHaveBeenCalledTimes(1)
  })

  // control: of the answers that are not `ok`, only `missing` closes; a refusal keeps the sheet open on its line.
  it('control: refused does not call onDone', async () => {
    const { props, tree } = sheet(async () => refused)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpRevokeOutcome'))).toBeTruthy())
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it.each<[string, () => Promise<HcpRevokeResult>]>([
    ['off (not in the brief)', async () => ({ ok: false, off: true })],
    ['a revoke that throws (not in the brief)', async () => Promise.reject(new Error('store'))],
  ])('%s: shows ConnectedAgents.FailGeneric, and does not close', async (_, onRevoke) => {
    const { props, tree } = sheet(onRevoke)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpRevokeOutcome'))).toBeTruthy())
    expect(tree.getByTestId(id('HcpRevokeOutcome')).props.accessibilityLabel).toBe('ConnectedAgents.FailGeneric')
    expect(tree.queryByText(/store/)).toBeNull()
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it('a later success clears an earlier outcome', async () => {
    const onRevoke = jest
      .fn<Promise<HcpRevokeResult>, []>()
      .mockResolvedValueOnce(unreachable)
      .mockResolvedValueOnce({ ok: true, connection: HCP_REVOKED.telling })
    const { props, tree } = sheet(onRevoke)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpRevokeOutcome'))).toBeTruthy())
    press(tree)
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1))
    expect(tree.queryByTestId(id('HcpRevokeOutcome'))).toBeNull()
  })

  it('once while a revoke is open: a second press sends nothing, and both buttons are disabled', async () => {
    let answer: (result: HcpRevokeResult) => void = () => undefined
    const { props, tree } = sheet(() => new Promise<HcpRevokeResult>((resolve) => (answer = resolve)))
    press(tree)
    press(tree)
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
    await act(async () => undefined)
    expect(disabled(tree, 'HcpRevokeConfirm')).toBe(true)
    expect(disabled(tree, 'HcpRevokeKeep')).toBe(true)
    await act(async () => answer(unreachable))
    expect(disabled(tree, 'HcpRevokeConfirm')).toBe(false)
    expect(props.onRevoke).toHaveBeenCalledTimes(1)
  })

  // control: once the open revoke answers, Revoke can be pressed again, so "once while open" is not "once ever".
  it('control: after an unreachable answer, a second press does revoke', async () => {
    const { props, tree } = sheet(async () => unreachable)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpRevokeOutcome'))).toBeTruthy())
    press(tree)
    await waitFor(() => expect(props.onRevoke).toHaveBeenCalledTimes(2))
  })
})

describe('the U2 views', () => {
  it('import no logic action: the HCP status reader and types only', () => {
    for (const file of ['HcpAgentListView.tsx', 'HcpRevokeSheet.tsx', 'HcpNoticeLine.tsx']) {
      const source = readFileSync(path.join(__dirname, '..', file), 'utf8')
      // A value import from track C's hcp/ logic (a sibling of screens/), other than `status` (hcpStatus reads a
      // record, it changes nothing), or from the module's own logic (a file directly under connected-agents/).
      const logic = [
        ...source.matchAll(
          /^import (?!type )[^\n]*from '(\.\.\/(?!status')[\w]+|\.\.\/\.\.\/(?!screens\/|components\/)[\w]+)'/gm
        ),
      ].map((m) => m[0])
      expect({ file, logic }).toEqual({ file, logic: [] })
      const imports = source.split('\n').filter((line) => line.startsWith('import '))
      expect(imports.filter((line) => /revokeHcpGrant|pollHcpNotice|useHcpNotice|addHcpMemory/.test(line))).toEqual([])
    }
  })
})
