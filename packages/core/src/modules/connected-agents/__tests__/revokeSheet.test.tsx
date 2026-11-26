/**
 * Step 7.10's screens and words (docs/plans/agent-connect-plan.md §6, §3.9): the Revoke sheet says "up to 4 hours"
 * and never that it is instant; the not-confirmed and unreachable lines with "Try again"; and no locale file says
 * "instant".
 */
import { fireEvent, render } from '@testing-library/react-native'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import RevokeAgentSheet from '../components/RevokeAgentSheet'
import RevokeOutcomeNotice from '../components/RevokeOutcomeNotice'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

describe('RevokeAgentSheet', () => {
  it('names the agent and, with rooms, the 4-hour tail; Revoke and Keep each do their one thing', () => {
    const onRevoke = jest.fn()
    const onKeep = jest.fn()
    const view = show(<RevokeAgentSheet name="Notes helper" inRooms onRevoke={onRevoke} onKeep={onKeep} />)
    expect(view.getByText('Revoke "Notes helper"?')).toBeTruthy()
    const body = view.getByTestId(id('RevokeAgentBody'))
    expect(body).toHaveTextContent(
      'It loses access to your memory and rooms. A room permission it already holds can work for up to 4 hours. Past messages stay.'
    )
    expect(body).toHaveTextContent(/up to 4 hours/)
    fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    expect([onRevoke.mock.calls.length, onKeep.mock.calls.length]).toEqual([1, 0])
    fireEvent.press(view.getByTestId(id('RevokeAgentKeep')))
    expect([onRevoke.mock.calls.length, onKeep.mock.calls.length]).toEqual([1, 1])
  })

  it("without rooms (P0) shows §6's no-room form", () => {
    const view = show(<RevokeAgentSheet name="Notes helper" inRooms={false} onRevoke={jest.fn()} onKeep={jest.fn()} />)
    expect(view.getByTestId(id('RevokeAgentBody'))).toHaveTextContent(
      'It loses access to your memory. Past messages stay.'
    )
  })

  it('while busy, neither button acts', () => {
    const onRevoke = jest.fn()
    const view = show(<RevokeAgentSheet name="N" inRooms onRevoke={onRevoke} onKeep={jest.fn()} busy />)
    fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    expect(onRevoke).not.toHaveBeenCalled()
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
