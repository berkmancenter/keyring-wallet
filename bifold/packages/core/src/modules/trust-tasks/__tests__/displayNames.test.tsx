/**
 * #12: codes stay out of sight. What a community, an agent and anyone else are
 * called on screen — never a DID — and the one place a DID can still be seen:
 * behind Details.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { communityTarget } from '../module/vtiCommunityLink'
import { agentDisplayName, agentDisplayNameStart, withAgentName } from '../screens/agentName'
import { communityLabelOf, communityLabelStartOf, partyLabelStartOf } from '../screens/communityName'
import { DidDetails } from '../screens/DidDetails'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// The key, and what was interpolated into it, so each case can be read.
const t = ((key: string, values?: Record<string, unknown>) =>
  values
    ? `${key}(${Object.entries(values)
        .filter(([k]) => k !== 'interpolation')
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key) as unknown as TFunction

const webvh = 'did:webvh:QmCommunity:vtc.example.org'
const peer = 'did:peer:2.Ez6LSabcdefghijklmnopqrstuvwxyz'

describe('a community, named in passing', () => {
  beforeEach(() => communityTarget.clear())

  it('by its published name, when it has one', () => {
    communityTarget.publishedName(webvh, 'Keyring Lab Community')
    expect(communityLabelOf(webvh, t)).toBe('Keyring Lab Community')
  })

  it("by a link's name only as a claim, in words — anyone can write a link", () => {
    communityTarget.set({ communityDid: webvh, name: 'Totally Official' })
    expect(communityLabelOf(webvh, t)).toBe('Community.ClaimedName(name=Totally Official)')
  })

  it('the published name beats what a link claims', () => {
    communityTarget.set({ communityDid: webvh, name: 'Totally Official' })
    communityTarget.publishedName(webvh, 'Keyring Lab Community')
    expect(communityLabelOf(webvh, t)).toBe('Keyring Lab Community')
  })

  it('unnamed: said to be unnamed, with its host — the host never poses as a name (#13/#14/#16)', () => {
    expect(communityLabelOf(webvh, t)).toBe('Community.UnnamedAt(host=vtc.example.org)')
  })

  it('unnamed and without a host: words, never the DID', () => {
    const label = communityLabelOf(peer, t)
    expect(label).toBe('Community.Unnamed')
    expect(label).not.toMatch(/did:/)
  })

  it('at the start of a sentence, capitalised', () => {
    const start = communityLabelStartOf(webvh, ((key: string) =>
      key === 'Community.UnnamedAt' ? 'an unnamed community (x)' : key) as unknown as TFunction)
    expect(start).toBe('An unnamed community (x)')
  })
})

describe('an agent', () => {
  const vtaDid = 'did:webvh:QmVta:dids.example.org:alice'
  it('by the name its operator set, first', () => {
    expect(agentDisplayName({ vtaDid, label: 'Lab agent', name: 'Alice’s agent' }, t)).toBe('Alice’s agent')
  })
  it("else by the enrolment offer's label", () => {
    expect(agentDisplayName({ vtaDid, label: 'Lab agent' }, t)).toBe('Lab agent')
  })
  it("a manual link's DID-as-label is no label: the host instead", () => {
    expect(agentDisplayName({ vtaDid, label: vtaDid }, t)).toBe('dids.example.org')
  })
  it('by the name the agent gave, once read, for that agent only', () => {
    const names = { [vtaDid]: 'runner' }
    expect(agentDisplayName(withAgentName({ vtaDid, label: 'Lab agent' }, names), t)).toBe('runner')
    expect(agentDisplayName(withAgentName({ vtaDid: 'did:webvh:QmB:b.example.org', label: 'B' }, names), t)).toBe('B')
    expect(agentDisplayName(withAgentName({ vtaDid, label: vtaDid }, undefined), t)).toBe('dids.example.org')
  })
  it('with neither a label nor a host: words, never the DID', () => {
    expect(agentDisplayName({ vtaDid: peer, label: peer }, t)).toBe('VtaLink.YourAgentFallback')
    const start = agentDisplayNameStart({ vtaDid: peer, label: peer }, ((key: string) =>
      key === 'VtaLink.YourAgentFallback' ? 'your agent' : key) as unknown as TFunction)
    expect(start).toBe('Your agent')
  })
})

describe('anyone else', () => {
  beforeEach(() => communityTarget.clear())
  it('by a published name when the DID is a community\'s, else "Someone at <host>", else "Someone"', () => {
    communityTarget.publishedName(webvh, 'Keyring Lab Community')
    expect(partyLabelStartOf(webvh, t)).toBe('Keyring Lab Community')
    expect(partyLabelStartOf('did:webvh:QmX:other.example.org', t)).toBe('Community.SomeoneAt(host=other.example.org)')
    expect(partyLabelStartOf(peer, t)).toBe('Community.Someone')
  })
})

describe('a DID behind Details', () => {
  it('is out of sight until the person opens Details', async () => {
    const tree = render(
      <BasicAppContext>
        <DidDetails did={peer} testIdStem="Probe" />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey('ProbeDid'))).toBeNull()
    expect(tree.queryByText(peer)).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('ProbeToggle'))))
    expect(tree.getByTestId(testIdWithKey('ProbeDid'))).toHaveTextContent(peer)
  })
})
