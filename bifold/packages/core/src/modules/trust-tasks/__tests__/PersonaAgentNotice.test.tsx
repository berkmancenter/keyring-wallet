/**
 * A community whose identity cannot sign in because of its agent is said where
 * the community is, by what the agent did: refused this phone, did not answer,
 * or is no longer linked (IN-350). It used to be an app-wide toast that covered
 * whatever screen was open, a contact's chat included, and said "didn't answer"
 * of an agent that had refused.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { PersonaAgentNotice } from '../screens/PersonaAgentNotice'

const mockState = jest.fn()
jest.mock('../module/vtiPersonaInbox', () => ({
  usePersonaAgentState: (communityDid: string | undefined) => mockState(communityDid),
}))

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org'
const id = (key: string) => testIdWithKey(key)
const show = (props: Partial<React.ComponentProps<typeof PersonaAgentNotice>> = {}) =>
  render(
    <BasicAppContext>
      <PersonaAgentNotice communityDid={COMMUNITY} {...props} />
    </BasicAppContext>
  )

describe('what a community says about its agent', () => {
  beforeEach(() => mockState.mockReset())

  test('nothing, while its identity signs in', () => {
    mockState.mockReturnValue(undefined)
    const tree = show()
    expect(mockState).toHaveBeenCalledWith(COMMUNITY)
    expect(tree.queryByTestId(id('PersonaAgentNotice'))).toBeNull()
  })

  test('an agent that refused this phone is said as that, never as one that did not answer', () => {
    mockState.mockReturnValue({ kind: 'refused' })
    const onOpenAgent = jest.fn()
    const tree = show({ onOpenAgent })
    const notice = tree.getByTestId(id('PersonaAgentNotice'))
    expect(notice).toHaveTextContent(/VtaLink\.PersonaAgentRefusedTitle/)
    expect(notice).toHaveTextContent(/VtaLink\.PersonaAgentRefusedBody/)
    expect(notice).not.toHaveTextContent(/PersonaAgentUnreachable/)
    fireEvent.press(tree.getByTestId(id('PersonaAgentNoticeOpen')))
    expect(onOpenAgent).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['unreachable', /VtaLink\.PersonaAgentUnreachableBody/],
    ['notLinked', /VtaLink\.PersonaAgentNotLinkedBody/],
  ])('%s: its own words', (kind, words) => {
    mockState.mockReturnValue({ kind })
    const notice = show().getByTestId(id('PersonaAgentNotice'))
    expect(notice).toHaveTextContent(words)
    expect(notice).not.toHaveTextContent(/PersonaAgentRefused/)
  })

  test('in a list, one line under the community, by the same reason', () => {
    mockState.mockReturnValue({ kind: 'refused' })
    const tree = show({ compact: true })
    expect(tree.getByTestId(id('PersonaAgentNoticeLine'))).toHaveTextContent('VtaLink.PersonaAgentRefusedLine')
    expect(tree.queryByTestId(id('PersonaAgentNotice'))).toBeNull()
  })

  test('the words: a refusal says what recovers it, and only an unanswered agent "didn\'t answer"', () => {
    expect(en.VtaLink.PersonaAgentRefusedBody).toBe(
      "Your agent no longer accepts this phone, so {{community}} can't connect. Its admin can add this phone back, or open My Agent and link this phone again."
    )
    for (const copy of [en, fr, ptBr]) {
      for (const key of [
        'PersonaAgentRefusedBody',
        'PersonaAgentUnreachableBody',
        'PersonaAgentNotLinkedBody',
      ] as const)
        expect(copy.VtaLink[key]).toContain('{{community}}')
      for (const key of [
        'PersonaAgentRefusedTitle',
        'PersonaAgentRefusedLine',
        'PersonaAgentUnreachableLine',
        'PersonaAgentNotLinkedLine',
      ] as const)
        expect(typeof copy.VtaLink[key]).toBe('string')
    }
    expect(en.VtaLink.PersonaAgentRefusedBody).not.toMatch(/didn't answer/)
    expect(en.VtaLink.PersonaAgentRefusedLine).not.toMatch(/didn't answer/)
  })
})
