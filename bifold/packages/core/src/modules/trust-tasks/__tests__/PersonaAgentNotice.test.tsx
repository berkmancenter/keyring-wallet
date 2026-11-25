/**
 * A community whose identity cannot sign in because of its agent is said where
 * the community is, by what the agent did: refused this phone, did not answer,
 * or is no longer linked (IN-350). It used to be an app-wide toast that covered
 * whatever screen was open, a contact's chat included, and said "didn't answer"
 * of an agent that had refused.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
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
// The agent linked now, and the community's identity under it.
let mockLinked: string | undefined
const mockGetPersona = jest.fn(
  async (_communityDid: string, _vtaDid?: string): Promise<{ did: string } | undefined> => undefined
)
jest.mock('../module/currentAgent', () => ({ currentAgentDid: () => mockLinked }))
jest.mock('../module/vtaAgent', () => ({ vtaAgent: { subscribe: () => () => undefined } }))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona(communityDid: string, vtaDid?: string) {
      return mockGetPersona(communityDid, vtaDid)
    }
  },
}))
// One agent for the app's life, as the provider gives.
const mockAgent = {}
jest.mock('@bifold/react-hooks', () => ({
  ...jest.requireActual('@bifold/react-hooks'),
  useAgent: () => ({ agent: mockAgent }),
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
  beforeEach(() => {
    mockState.mockReset()
    mockLinked = undefined
    mockGetPersona.mockReset()
  })

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

// 277.7, 11-03: after leaving First VTC and joining again with a new identity, an older identity of it, under an agent
// no longer linked, failed to sign in; the community and My Agent said "Your agent is no longer connected" while the new
// identity was signed in.
describe("the notice speaks for the community's own identity", () => {
  const OLD = 'did:webvh:QmOld:ids.example:element-garlic'
  const NEW = 'did:webvh:QmNew:ids.example:cash-twin'
  const LINKED = 'did:webvh:QmVta:vta.example:agent'
  const failed = (did: string) => ({ kind: 'notLinked', persona: { did, communityDid: COMMUNITY } })
  const shown = async (compact = false) => {
    const tree = show({ compact })
    await act(async () => undefined)
    return tree.queryByTestId(id(compact ? 'PersonaAgentNoticeLine' : 'PersonaAgentNotice'))
  }
  beforeEach(() => {
    mockState.mockReset()
    mockGetPersona.mockReset()
  })

  test.each([false, true])(
    'an older identity under an agent no longer linked says nothing, the community has another (compact: %s)',
    async (compact) => {
      mockState.mockReturnValue(failed(OLD))
      mockLinked = LINKED
      mockGetPersona.mockResolvedValue({ did: NEW })
      expect(await shown(compact)).toBeNull()
      expect(mockGetPersona).toHaveBeenCalledWith(COMMUNITY, LINKED)
    }
  )

  test("the community's own identity under a gone agent is still said (control): no agent is linked", async () => {
    mockState.mockReturnValue(failed(NEW))
    mockLinked = undefined
    expect(await shown()).not.toBeNull()
    expect(mockGetPersona).not.toHaveBeenCalled()
  })

  test("the identity that failed is the community's under the agent linked now: said (control)", async () => {
    mockState.mockReturnValue(failed(NEW))
    mockLinked = LINKED
    mockGetPersona.mockResolvedValue({ did: NEW })
    expect(await shown()).not.toBeNull()
  })

  test('no identity under the agent linked now, or one that cannot be read: said', async () => {
    mockState.mockReturnValue(failed(OLD))
    mockLinked = LINKED
    mockGetPersona.mockResolvedValueOnce(undefined)
    expect(await shown()).not.toBeNull()
    mockGetPersona.mockRejectedValueOnce(new Error('store locked'))
    expect(await shown()).not.toBeNull()
  })
})
