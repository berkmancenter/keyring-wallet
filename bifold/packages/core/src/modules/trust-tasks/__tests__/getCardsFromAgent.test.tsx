/**
 * Manage → "Get your cards from your agent" (226): every identity on this
 * phone asks its agent for the cards it keeps; the person sees a running
 * count, then what came back and, in words, what did not. A phone with no
 * identity (a new phone, before adoption) is not offered it.
 */
import type { Agent } from '@credo-ts/core'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { persona } from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiPersona } from '../module/VtiIdentityStore'
import { GetCardsFromAgent, getCardsFromAgent, type GetCardsDeps } from '../screens/GetCardsFromAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-i18next', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', t, changeLanguage: () => new Promise(() => {}) } }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  }
})

const agent = {} as Agent
const second: VtiPersona = { ...persona, communityDid: 'did:webvh:QmOther:vtc.example:first-vtc', did: 'did:webvh:QmP2:x' }

const deps = (answers: Record<string, 'down' | { found: number; restored: string[]; refused: { reason: 'failedCheck' | 'notOurs' | 'unreadable' }[] }>): GetCardsDeps => ({
  store: () => ({}) as never,
  taskFor: async (_a, p) => {
    if (answers[p.did] === 'down') throw new Error('no answer')
    return (async () => ({})) as never
  },
  recover: (async (_a: Agent, _s: unknown, p: VtiPersona, _t: unknown, o: { onProgress?: (x: { found: number; restored: number }) => void }) => {
    const got = answers[p.did] as { found: number; restored: string[]; refused: never[] }
    o.onProgress?.({ found: got.found, restored: 0 })
    o.onProgress?.({ found: got.found, restored: got.restored.length })
    return got
  }) as never,
})

describe('getting the cards back, identity by identity', () => {
  it('adds up across identities, counts one whose agent is down, and goes on with the others', async () => {
    const progress: { found: number; restored: number }[] = []
    const got = await getCardsFromAgent(
      agent,
      [persona, second],
      (p) => progress.push(p),
      deps({
        [persona.did]: { found: 3, restored: ['a', 'b'], refused: [{ reason: 'failedCheck' }] },
        [second.did]: 'down',
      })
    )
    expect(got).toEqual({ found: 3, restored: 2, refused: [{ reason: 'failedCheck' }], unreachable: 1 })
    expect(progress.at(-1)).toEqual({ found: 3, restored: 2 })
  })

  it('the count runs on from one identity to the next', async () => {
    const progress: { found: number; restored: number }[] = []
    await getCardsFromAgent(
      agent,
      [persona, second],
      (p) => progress.push(p),
      deps({
        [persona.did]: { found: 2, restored: ['a', 'b'], refused: [] },
        [second.did]: { found: 1, restored: ['c'], refused: [] },
      })
    )
    expect(progress.at(-1)).toEqual({ found: 3, restored: 3 })
  })
})

describe('the Manage row', () => {
  const renderRow = (personas: VtiPersona[], d: GetCardsDeps) =>
    render(
      <BasicAppContext>
        <GetCardsFromAgent agent={agent} personas={personas} deps={d} />
      </BasicAppContext>
    )

  it('is not offered on a phone with no identity', () => {
    const tree = renderRow([], deps({}))
    expect(tree.queryByTestId(testIdWithKey('AgentGetCards'))).toBeNull()
  })

  it('says how many came back, and why the others did not, in words', async () => {
    const tree = renderRow(
      [persona],
      deps({ [persona.did]: { found: 4, restored: ['a', 'b'], refused: [{ reason: 'failedCheck' }, { reason: 'notOurs' }] } })
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=2\)/)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_failedCheck'))).toHaveTextContent(
      'VtaLink.CardsBackFailedCheck(count=1)'
    )
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_notOurs'))).toHaveTextContent(
      'VtaLink.CardsBackNotOurs(count=1)'
    )
    expect(tree.queryByTestId(testIdWithKey('AgentGetCardsRefused_unreadable'))).toBeNull()
  })

  it('an agent that does not answer is said plainly, and the button can be tried again', async () => {
    const tree = renderRow([persona], deps({ [persona.did]: 'down' }))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackUnreachable')
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).not.toBeDisabled()
  })

  it('nothing kept for these communities is not an error', async () => {
    const tree = renderRow([persona], deps({ [persona.did]: { found: 0, restored: [], refused: [] } }))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackNone')
  })
})
