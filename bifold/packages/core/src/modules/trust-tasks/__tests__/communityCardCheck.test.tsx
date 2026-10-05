/**
 * A refusal is learned only by asking the community where a request stands
 * (it pushes none), and asking signs the shared session in as that identity.
 * So "Your agent" asks on its own only for the community the shared session
 * already holds, and offers "Check now" for any other open request (#269:
 * My Agent said "is deciding" for 14 min after a refusal).
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtiAgent } from '../module/vtiAgent'
import { CommunityCard, communityCardKey } from '../screens/CommunityCard'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockReadJoinState = jest.fn()
jest.mock('../module/vtiJoin', () => ({
  ...jest.requireActual('../module/vtiJoin'),
  readJoinState: (...args: unknown[]) => mockReadJoinState(...args),
}))

type Setter = { set(next: Record<string, unknown>): void }
const COMMUNITY = 'did:webvh:card-check:community'
const ME = 'did:webvh:card-check:me'
const persona = {
  did: ME,
  communityDid: COMMUNITY,
  vtaDid: 'did:webvh:card-check:vta',
  contextId: 'ctx',
  vtaKeyIds: { signing: 's', keyAgreement: 'k' },
  kmsKeyIds: { signing: 's', keyAgreement: 'k' },
  createdAt: '2026-10-04T00:00:00Z',
}
const pending = { kind: 'pending', submission: { communityDid: COMMUNITY, sentAt: 't', acknowledgedAt: 't' } }
const fakeAgent = {
  genericRecords: { findAllByQuery: async () => [] },
  config: { logger: {} },
} as never

const show = async () => {
  const tree = render(
    <BasicAppContext>
      <CommunityCard
        agent={fakeAgent}
        communityDid={COMMUNITY}
        persona={persona as never}
        invited={false}
        vetter={false}
        onOpen={() => undefined}
        onPrimary={() => undefined}
      />
    </BasicAppContext>
  )
  await act(async () => {
    await Promise.resolve()
  })
  return tree
}
const key = communityCardKey(COMMUNITY)

beforeEach(() => {
  mockReadJoinState.mockReset()
  mockReadJoinState.mockResolvedValue(pending)
})
afterEach(() => (vtiAgent as unknown as Setter).set({ did: undefined }))

describe('learning where a request stands, from "Your agent"', () => {
  it('another identity holds the shared session: no asking on its own, and "Check now" asks', async () => {
    ;(vtiAgent as unknown as Setter).set({ did: 'did:webvh:card-check:someone-else' })
    const tree = await show()
    expect(mockReadJoinState).toHaveBeenCalledWith(expect.anything(), COMMUNITY, { poll: false })
    mockReadJoinState.mockClear()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(`AgentCommunityCheck_${key}`)))
    })
    expect(mockReadJoinState).toHaveBeenCalledWith(expect.anything(), COMMUNITY, { poll: true })
  })

  it("the shared session already holds this card's identity: it asks on its own, with nothing to tap", async () => {
    ;(vtiAgent as unknown as Setter).set({ did: ME })
    const tree = await show()
    expect(mockReadJoinState).toHaveBeenCalledWith(expect.anything(), COMMUNITY, { poll: true })
    expect(tree.queryByTestId(testIdWithKey(`AgentCommunityCheck_${key}`))).toBeNull()
  })

  it('a member has nothing to check', async () => {
    mockReadJoinState.mockResolvedValue({ kind: 'member', membership: { communityDid: COMMUNITY } })
    const tree = await show()
    expect(tree.queryByTestId(testIdWithKey(`AgentCommunityCheck_${key}`))).toBeNull()
  })
})

// IN-120: an admin saw a persona DID the person had never been shown.
describe('the code the community sees for this identity', () => {
  it('is behind "Show the code they see", with who sees it, and can be copied', async () => {
    ;(Clipboard.setString as jest.Mock).mockClear()
    const tree = await show()
    const stem = `AgentCommunityIdentity_${key}`
    expect(tree.getByTestId(testIdWithKey(`${stem}Toggle`))).toHaveTextContent(/VtaLink\.ShowIdentityCode/)
    // Words first: the identifier is not on the card until asked for.
    expect(tree.queryByTestId(testIdWithKey(`${stem}Did`))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey(`${stem}Toggle`)))
    expect(tree.getByTestId(testIdWithKey(`${stem}Did`))).toHaveTextContent(ME)
    expect(tree.getByTestId(testIdWithKey(`${stem}Hint`))).toHaveTextContent(/VtaLink\.ShowIdentityCodeHint/)
    fireEvent.press(tree.getByTestId(testIdWithKey(`${stem}Copy`)))
    expect(Clipboard.setString).toHaveBeenCalledWith(ME)
    expect(tree.getByTestId(testIdWithKey(`${stem}Copy`))).toHaveTextContent(/VtaLink\.KeyCopied/)
  })
})
