/**
 * Step 7.10's sheet and words (docs/plans/agent-connect-plan.md §6, §3.9; canvas frame 19): the Revoke sheet as a view
 * whose "Revoke" calls `onRevoke` and shows what it came to; the Revoke incomplete and Revoke not confirmed lines with
 * "Try again"; the "up to 4 hours" body; and no locale file says "instant".
 *
 * The test translation answers the key, not the English (`__mocks__/react-i18next.ts`), so the screens are checked by
 * key and testID, as the module's other suites do; the English of the five keys is checked once against the locale
 * file.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import React from 'react'
import { StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { testIdWithKey } from '../../../utils/testable'
import RevokeOutcomeNotice, { RevokeViewOutcome } from '../components/RevokeOutcomeNotice'
import { AGENT_COLORS } from '../components/agentStyle'
import { RevokableConnection, RevokeConnectionStore, RevokeDeps, RevokeVta, revokeAgentConnection } from '../revoke'
import RevokeAgentSheet from '../screens/RevokeAgentSheet'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

const NAME = 'Notes helper'
const answers = (o: RevokeViewOutcome) => jest.fn(async () => o)

describe('RevokeAgentSheet', () => {
  it('names the agent and, with rooms, the 4-hour tail', () => {
    const view = show(
      <RevokeAgentSheet name={NAME} hasRooms onRevoke={answers({ kind: 'revoked' })} onKeep={jest.fn()} />
    )
    expect(view.getByText('ConnectedAgents.RevokeTitle')).toBeTruthy()
    expect(view.getByTestId(id('RevokeAgentBody'))).toHaveTextContent(/^ConnectedAgents\.RevokeBody$/)
  })

  it("without rooms (P0) shows §6's no-room form", () => {
    const view = show(
      <RevokeAgentSheet name={NAME} hasRooms={false} onRevoke={answers({ kind: 'revoked' })} onKeep={jest.fn()} />
    )
    expect(view.getByTestId(id('RevokeAgentBody'))).toHaveTextContent(/^ConnectedAgents\.RevokeBodyNoRooms$/)
  })

  it('the P0 sheet has no "Also delete what it remembered" row (P2, step 7.18): only Revoke and Keep', () => {
    const view = show(
      <RevokeAgentSheet name={NAME} hasRooms={false} onRevoke={answers({ kind: 'revoked' })} onKeep={jest.fn()} />
    )
    expect(view.queryByRole('checkbox')).toBeNull()
    expect(view.queryByText(/delete|remember/i)).toBeNull()
    expect(view.getAllByRole('button').map((b) => b.props.testID)).toEqual([
      id('RevokeAgentConfirm'),
      id('RevokeAgentKeep'),
    ])
  })

  it('looks like canvas frame 19: Revoke filled in the danger red, Keep outlined in purple', () => {
    const view = show(
      <RevokeAgentSheet name={NAME} hasRooms onRevoke={answers({ kind: 'revoked' })} onKeep={jest.fn()} />
    )
    const revoke = StyleSheet.flatten(view.getByTestId(id('RevokeAgentConfirm')).props.style)
    const keep = StyleSheet.flatten(view.getByTestId(id('RevokeAgentKeep')).props.style)
    expect(revoke).toMatchObject({ backgroundColor: AGENT_COLORS.danger })
    expect(revoke.borderWidth ?? 0).toBe(0)
    expect(keep).toMatchObject({ backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary })
  })

  it('"Keep" closes and runs nothing', () => {
    const onRevoke = answers({ kind: 'revoked' })
    const onKeep = jest.fn()
    const view = show(<RevokeAgentSheet name={NAME} hasRooms onRevoke={onRevoke} onKeep={onKeep} />)
    fireEvent.press(view.getByTestId(id('RevokeAgentKeep')))
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(onRevoke).not.toHaveBeenCalled()
  })

  it('"Revoke" calls onRevoke once; revoked shows no notice', async () => {
    const onRevoke = answers({ kind: 'revoked' })
    const view = show(<RevokeAgentSheet name={NAME} hasRooms onRevoke={onRevoke} onKeep={jest.fn()} />)
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    expect(onRevoke).toHaveBeenCalledTimes(1)
    expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull()
  })

  it('Revoke incomplete: the unreachable line, and "Try again" runs it again', async () => {
    const onRevoke = jest
      .fn<Promise<RevokeViewOutcome>, []>()
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'revoked' })
    const view = show(<RevokeAgentSheet name={NAME} hasRooms onRevoke={onRevoke} onKeep={jest.fn()} />)
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    await waitFor(() => expect(view.getByText('ConnectedAgents.RevokeUnreachable')).toBeTruthy())
    expect(view.getByText('ConnectedAgents.StatusRevokeNotConfirmed')).toBeTruthy()
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeTryAgain')))
    })
    expect(onRevoke).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull())
  })

  it('Revoke not confirmed: "may still have access", with "Try again"', async () => {
    const view = show(
      <RevokeAgentSheet name={NAME} hasRooms onRevoke={answers({ kind: 'notConfirmed' })} onKeep={jest.fn()} />
    )
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    await waitFor(() => expect(view.getByText('ConnectedAgents.RevokeNotConfirmedBody')).toBeTruthy())
    expect(view.getByText('ConnectedAgents.StatusRevokeNotConfirmed')).toBeTruthy()
    expect(view.queryByText('ConnectedAgents.RevokeUnreachable')).toBeNull()
    expect(view.getByTestId(id('RevokeTryAgain'))).toBeTruthy()
  })

  it('a revoke that throws (no record, or a state with no revoke) leaves the sheet as it was', async () => {
    const onRevoke = jest.fn(async (): Promise<RevokeViewOutcome> => {
      throw new Error('cannot be revoked')
    })
    const view = show(<RevokeAgentSheet name={NAME} hasRooms onRevoke={onRevoke} onKeep={jest.fn()} />)
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    expect(onRevoke).toHaveBeenCalledTimes(1)
    expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull()
    expect(view.getByTestId(id('RevokeAgentConfirm')).props.accessibilityState).toMatchObject({ disabled: false })
  })

  it("takes revokeAgentConnection's outcome as it is (what the wiring PR will pass)", async () => {
    // The view does not import revoke.ts; this checks the two fit, over an in-memory store and a fake VTA.
    const records = new Map<string, RevokableConnection>([
      ['a', { id: 'a', name: NAME, agentDid: 'a', deviceId: 'dev-1', state: 'active', keyChanged: false }],
    ])
    const store: RevokeConnectionStore = {
      list: async () => [...records.values()].map((r) => ({ ...r })),
      get: async (key) => (records.has(key) ? { ...(records.get(key) as RevokableConnection) } : undefined),
      put: async (record) => {
        records.set(record.id, { ...record })
      },
      remove: async (key) => {
        records.delete(key)
      },
    }
    const findAgentEntries = jest
      .fn()
      .mockRejectedValueOnce(new Error('the VTA did not answer'))
      .mockResolvedValue({ complete: true, matches: [] })
    const deps: RevokeDeps = { store, vta: { findAgentEntries, revokeSubject: jest.fn() } as unknown as RevokeVta }
    const view = show(
      <RevokeAgentSheet name={NAME} hasRooms onRevoke={() => revokeAgentConnection(deps, 'a')} onKeep={jest.fn()} />
    )
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    await waitFor(() => expect(view.getByText('ConnectedAgents.RevokeUnreachable')).toBeTruthy())
    expect(records.get('a')?.state).toBe('revoking')
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeTryAgain')))
    })
    await waitFor(() => expect(records.get('a')?.state).toBe('revoked'))
    expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull()
  })
})

describe('RevokeOutcomeNotice', () => {
  it('not confirmed: the status, "may still have access" and Try again', () => {
    const onTryAgain = jest.fn()
    const view = show(<RevokeOutcomeNotice name={NAME} outcome={{ kind: 'notConfirmed' }} onTryAgain={onTryAgain} />)
    expect(view.getByText('ConnectedAgents.StatusRevokeNotConfirmed')).toBeTruthy()
    expect(view.getByText('ConnectedAgents.RevokeNotConfirmedBody')).toBeTruthy()
    fireEvent.press(view.getByTestId(id('RevokeTryAgain')))
    expect(onTryAgain).toHaveBeenCalledTimes(1)
  })

  it('unreachable: "still connected", and no Try again without a handler', () => {
    const view = show(<RevokeOutcomeNotice name={NAME} outcome={{ kind: 'unreachable' }} />)
    expect(view.getByText('ConnectedAgents.RevokeUnreachable')).toBeTruthy()
    expect(view.queryByTestId(id('RevokeTryAgain'))).toBeNull()
  })

  it('revoked: nothing', () => {
    const view = show(<RevokeOutcomeNotice name={NAME} outcome={{ kind: 'revoked' }} />)
    expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull()
  })
})

describe("the five keys' English (§6)", () => {
  const words = (en as unknown as { ConnectedAgents: Record<string, string> }).ConnectedAgents

  it('says "up to 4 hours" with rooms, the no-room form without, and the two not-confirmed lines', () => {
    expect(words.RevokeTitle).toBe('Revoke "{{name}}"?')
    expect(words.RevokeBody).toBe(
      'It loses access to your memory and rooms. A room permission it already holds can work for up to 4 hours. Past messages stay.'
    )
    expect(words.RevokeBodyNoRooms).toBe('It loses access to your memory. Past messages stay.')
    expect(words.RevokeUnreachable).toBe('We couldn\'t reach your VTA, so "{{name}}" is still connected.')
    expect(words.RevokeNotConfirmedBody).toBe('"{{name}}" may still have access. Keyring will check again.')
  })
})

describe('no locale file says "instant" (§6, step 7.10)', () => {
  // "Instant" in the sense the plan bans: immediate. In English any form of the word. French and Portuguese use the
  // same letters for "a moment" in strings unrelated to agents ("Réessayez dans un instant", 36 lines; "Tente de novo
  // em instantes", 10), which say nothing about revoking; there the banned word is the adjective and adverb,
  // "instantané(ment)" and "instantâneo"/"instantaneamente".
  const INSTANT: Record<string, RegExp> = {
    'en/en.json': /\binstant/i,
    'fr/fr.json': /\binstantan/i,
    'pt-br/pt-br.json': /\binstant[aâ]ne/i,
  }
  const dir = path.resolve(__dirname, '../../../localization')
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(path.join(dir, d.name)).map((f) => path.join(dir, d.name, f)))
    .filter((f) => f.endsWith('.json'))

  it('reads every locale file', () => {
    expect(files.map((f) => path.relative(dir, f)).sort()).toEqual(['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json'])
  })

  it.each(['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json'])('%s', (file) => {
    const text = readFileSync(path.join(dir, file), 'utf8')
    const hits = text.split('\n').filter((line) => INSTANT[file].test(line))
    expect(hits).toEqual([])
  })

  it('control: each pattern bites the words it is for and spares "a moment"', () => {
    const bites: [string, string][] = [
      ['en/en.json', 'Revoking is instant.'],
      ['en/en.json', 'Instantly gone'],
      ['fr/fr.json', 'Une révocation instantanée'],
      ['fr/fr.json', 'Révoqué instantanément'],
      ['pt-br/pt-br.json', 'Revogação instantânea'],
      ['pt-br/pt-br.json', 'Revogado instantaneamente'],
    ]
    for (const [file, text] of bites) expect([text, INSTANT[file].test(text)]).toEqual([text, true])
    const spares: [string, string][] = [
      ['fr/fr.json', 'Réessayez dans un instant.'],
      ['pt-br/pt-br.json', 'Tente de novo em instantes.'],
    ]
    for (const [file, text] of spares) expect([text, INSTANT[file].test(text)]).toEqual([text, false])
  })
})
