/**
 * Several agents, step 3: "Join <community> with which agent?". Shown only with
 * several agents; the current one joins, another is one tap away, and an agent
 * already holding an identity here is suggested, never switched to unasked.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { JoinWithAgent, suggestedAgent } from '../screens/JoinWithAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
const COMMUNITY = 'did:webvh:join-with-agent:community'
const HOME = 'did:webvh:join-with-agent:home-vta'
const WORK = 'did:webvh:join-with-agent:work-vta'

const personaRecord = (vtaDid: string) => ({
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: `${vtaDid}|${COMMUNITY}` },
  content: { did: `did:webvh:me-at-${vtaDid}`, communityDid: COMMUNITY, vtaDid },
})
const fakeAgent = (records: ReturnType<typeof personaRecord>[]) => ({
  agent: {
    genericRecords: {
      findAllByQuery: async (q: Record<string, string>) =>
        records.filter((r) => Object.entries(q).every(([k, v]) => (r.tags as Record<string, string>)[k] === v)),
      delete: async () => undefined,
    },
    config: { logger: {} },
  },
})

const linkedTo = (vtaDid: string, agents: string[]) =>
  controller.set({
    agents: agents.map((a) => ({ vtaDid: a, label: a === HOME ? 'Home' : 'Work' })),
    link: { kind: 'linked', vtaDid, label: 'x', linkedAt: 't', connection: { kind: 'online', since: 0 } },
  })

const show = async (records: ReturnType<typeof personaRecord>[] = []) => {
  ;(useAgent as jest.Mock).mockReturnValue(fakeAgent(records))
  const tree = render(
    <BasicAppContext>
      <JoinWithAgent communityDid={COMMUNITY} name="Lab" />
    </BasicAppContext>
  )
  await act(async () => {
    await Promise.resolve()
  })
  return tree
}

afterEach(() => {
  controller.set({ agents: undefined })
  jest.restoreAllMocks()
})

describe('which agent to suggest', () => {
  it('one that holds an identity here, when the current one does not; else none', () => {
    expect(suggestedAgent(HOME, [WORK])).toBe(WORK)
    expect(suggestedAgent(HOME, [HOME, WORK])).toBeUndefined()
    expect(suggestedAgent(HOME, [])).toBeUndefined()
  })
})

describe('Join with which agent?', () => {
  it('is not shown with one agent', async () => {
    linkedTo(HOME, [HOME])
    const tree = await show()
    expect(tree.queryByTestId(testIdWithKey('JoinWithAgent'))).toBeNull()
  })

  it('with several, the current one joins and another is one tap away', async () => {
    linkedTo(HOME, [HOME, WORK])
    const use = jest.spyOn(vtaAgent, 'useAgent').mockResolvedValue(undefined)
    const tree = await show()
    expect(tree.getByTestId(testIdWithKey('JoinAgentNote_0'))).toHaveTextContent('Join.JoiningWithThis')
    expect(tree.queryByTestId(testIdWithKey('JoinAgentSuggested'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('JoinAgentRow_1')))
    expect(use).toHaveBeenCalledWith(expect.anything(), WORK)
  })

  it('an agent already holding an identity here is suggested, and used only when the person says so', async () => {
    linkedTo(HOME, [HOME, WORK])
    const use = jest.spyOn(vtaAgent, 'useAgent').mockResolvedValue(undefined)
    const tree = await show([personaRecord(WORK)])
    expect(tree.getByTestId(testIdWithKey('JoinAgentSuggested'))).toHaveTextContent(/Join\.AgentHasIdentity/)
    expect(tree.getByTestId(testIdWithKey('JoinAgentNote_1'))).toHaveTextContent('Join.AlreadyHasIdentity')
    expect(use).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('JoinUseSuggestedAgent')))
    expect(use).toHaveBeenCalledWith(expect.anything(), WORK)
  })
})
