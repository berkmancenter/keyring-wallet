/**
 * Step 7.10's screens and words (docs/plans/agent-connect-plan.md §6, §3.9): the Revoke sheet says "up to 4 hours"
 * and never that it is instant, and its "Revoke" runs `revokeAgentConnection`; the Revoke incomplete and Revoke not
 * confirmed lines with "Try again"; and no locale file says "instant".
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import React from 'react'

import type {
  RevokableConnection,
  RevokeConnectionStore,
  RevokeDeps,
  RevokeVta,
} from '../../src/modules/connected-agents/revoke'
import RevokeAgentSheet from '../../src/screens/RevokeAgentSheet'
import RevokeOutcomeNotice from '../../src/screens/RevokeOutcomeNotice'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

const AGENT = { id: 'did:key:z6MkAgent', name: 'Notes helper' }

/** An in-memory store with one active record, and a VTA whose listing is set per test. */
function fakes() {
  const records = new Map<string, RevokableConnection>([
    [
      AGENT.id,
      { id: AGENT.id, name: AGENT.name, agentDid: AGENT.id, deviceId: 'dev-1', state: 'active', keyChanged: false },
    ],
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
  const findAgentEntries = jest.fn<ReturnType<RevokeVta['findAgentEntries']>, []>(async () => ({
    complete: true,
    matches: [],
  }))
  const revokeSubject = jest.fn(async () => undefined)
  const vta = { findAgentEntries, revokeSubject } as unknown as RevokeVta
  const deps: RevokeDeps = { store, vta, now: () => Date.parse('2026-11-26T12:00:00Z') }
  return { records, deps, findAgentEntries, revokeSubject }
}

describe('RevokeAgentSheet', () => {
  it('names the agent and, with rooms, the 4-hour tail', () => {
    const view = show(<RevokeAgentSheet agent={AGENT} inRooms deps={fakes().deps} onKeep={jest.fn()} />)
    expect(view.getByText('Revoke "Notes helper"?')).toBeTruthy()
    const body = view.getByTestId(id('RevokeAgentBody'))
    expect(body).toHaveTextContent(
      'It loses access to your memory and rooms. A room permission it already holds can work for up to 4 hours. Past messages stay.'
    )
    expect(body).toHaveTextContent(/up to 4 hours/)
  })

  it("without rooms (P0) shows §6's no-room form", () => {
    const view = show(<RevokeAgentSheet agent={AGENT} inRooms={false} deps={fakes().deps} onKeep={jest.fn()} />)
    expect(view.getByTestId(id('RevokeAgentBody'))).toHaveTextContent(
      'It loses access to your memory. Past messages stay.'
    )
  })

  it('"Keep" closes and sends nothing', () => {
    const f = fakes()
    const onKeep = jest.fn()
    const view = show(<RevokeAgentSheet agent={AGENT} inRooms deps={f.deps} onKeep={onKeep} />)
    fireEvent.press(view.getByTestId(id('RevokeAgentKeep')))
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(f.findAgentEntries).not.toHaveBeenCalled()
    expect(f.records.get(AGENT.id)?.state).toBe('active')
  })

  it('"Revoke" runs revokeAgentConnection: revoked once a full listing shows no entry', async () => {
    const f = fakes()
    const onOutcome = jest.fn()
    const view = show(<RevokeAgentSheet agent={AGENT} inRooms deps={f.deps} onKeep={jest.fn()} onOutcome={onOutcome} />)
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith({ kind: 'revoked' }))
    expect(f.findAgentEntries).toHaveBeenCalledWith({ deviceId: 'dev-1', subject: AGENT.id })
    expect(f.records.get(AGENT.id)?.state).toBe('revoked')
    expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull()
  })

  it('Revoke incomplete: "still connected", and "Try again" runs it again', async () => {
    const f = fakes()
    f.findAgentEntries.mockRejectedValueOnce(new Error('the VTA did not answer'))
    const onOutcome = jest.fn()
    const view = show(<RevokeAgentSheet agent={AGENT} inRooms deps={f.deps} onKeep={jest.fn()} onOutcome={onOutcome} />)
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    await waitFor(() =>
      expect(view.getByText('We couldn\'t reach your VTA, so "Notes helper" is still connected.')).toBeTruthy()
    )
    expect(f.records.get(AGENT.id)?.state).toBe('revoking')
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeTryAgain')))
    })
    await waitFor(() => expect(onOutcome).toHaveBeenLastCalledWith({ kind: 'revoked' }))
    expect(f.records.get(AGENT.id)?.state).toBe('revoked')
  })

  it('Revoke not confirmed: a partial listing is not proof', async () => {
    const f = fakes()
    f.findAgentEntries.mockResolvedValue({ complete: false, matches: [] })
    const view = show(<RevokeAgentSheet agent={AGENT} inRooms deps={f.deps} onKeep={jest.fn()} />)
    await act(async () => {
      fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    })
    await waitFor(() =>
      expect(view.getByText('"Notes helper" may still have access. Keyring will check again.')).toBeTruthy()
    )
    expect(view.getByText('Revoke not confirmed')).toBeTruthy()
    expect(f.records.get(AGENT.id)?.state).toBe('revoking')
  })
})

describe('RevokeOutcomeNotice', () => {
  it('not confirmed: the status, "may still have access" and Try again', () => {
    const onTryAgain = jest.fn()
    const view = show(
      <RevokeOutcomeNotice
        name="Notes helper"
        outcome={{ kind: 'notConfirmed', reason: 'partialListing' }}
        onTryAgain={onTryAgain}
      />
    )
    expect(view.getByText('Revoke not confirmed')).toBeTruthy()
    expect(view.getByText('"Notes helper" may still have access. Keyring will check again.')).toBeTruthy()
    fireEvent.press(view.getByTestId(id('RevokeTryAgain')))
    expect(onTryAgain).toHaveBeenCalledTimes(1)
  })

  it('unreachable: "still connected"', () => {
    const view = show(<RevokeOutcomeNotice name="Notes helper" outcome={{ kind: 'unreachable' }} />)
    expect(view.getByText('We couldn\'t reach your VTA, so "Notes helper" is still connected.')).toBeTruthy()
    expect(view.queryByTestId(id('RevokeTryAgain'))).toBeNull()
  })

  it('revoked: nothing', () => {
    const view = show(<RevokeOutcomeNotice name="Notes helper" outcome={{ kind: 'revoked' }} />)
    expect(view.queryByTestId(id('RevokeOutcomeNotice'))).toBeNull()
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
  const dir = path.resolve(__dirname, '../../src/localization')
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
