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
import { agentDisplayName, agentDisplayNameStart, agentNameInDid, withAgentName } from '../screens/agentName'
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

  it('unnamed: said to be, with the end of its SCID — never its host, which merged communities on one host (IN-26)', () => {
    const label = communityLabelOf(webvh, t)
    expect(label).toBe('Community.UnnamedRef(ref=…munity)')
    expect(label).not.toContain('vtc.example.org')
  })

  it("unnamed with a path: the operator's handle tells it apart", () => {
    expect(communityLabelOf('did:webvh:QmCommunity:vtc.example.org:keyring-test-vtc', t)).toBe(
      'Community.UnnamedRef(ref=keyring-test-vtc)'
    )
  })

  it('unnamed and without a host: words, never the DID', () => {
    const label = communityLabelOf(peer, t)
    expect(label).toBe('Community.UnnamedRef(ref=…uvwxyz)')
    expect(label).not.toMatch(/did:/)
  })

  it("at the start of a sentence: a name in capitals, an unnamed community's handle as written", () => {
    const start = communityLabelStartOf(webvh, ((key: string, values?: { ref?: string }) =>
      key === 'Community.UnnamedRef' ? `${values?.ref} (no name published yet)` : key) as unknown as TFunction)
    expect(start).toBe('…munity (no name published yet)')
    const handle = 'did:webvh:QmCommunity:vtc.example.org:al-community2-vtc'
    const tUnnamed = ((key: string, values?: { ref?: string }) =>
      key === 'Community.UnnamedRef' ? `${values?.ref} (no name published yet)` : key) as unknown as TFunction
    expect(communityLabelStartOf(handle, tUnnamed)).toBe('al-community2-vtc (no name published yet)')
    communityTarget.publishedName(handle, 'lab community')
    expect(communityLabelStartOf(handle, tUnnamed)).toBe('Lab community')
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
  it("a manual link's DID-as-label is no label, and the host is never a name: the name in its DID's path", () => {
    // The host is the agent host's own domain, a provider named where a person
    // expects their agent's name (225 gate). The path's last segment is what
    // its maker called it: an agent made with pnm publishes no name (10-06).
    expect(agentDisplayName({ vtaDid, label: vtaDid }, t)).toBe('alice')
  })
  it('a label that is only the host (stored by a link before 226) is no name either', () => {
    expect(agentDisplayName({ vtaDid, label: 'dids.example.org' }, t)).toBe('alice')
  })
  it('a DID with no readable path name: plain words, never the host or a hash', () => {
    const atHost = 'did:webvh:QmVta:dids.example.org'
    expect(agentDisplayName({ vtaDid: atHost, label: atHost }, t)).toBe('VtaLink.YourAgentFallback')
    const hashed = 'did:webvh:QmVta:dids.example.org:QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx'
    expect(agentDisplayName({ vtaDid: hashed, label: hashed }, t)).toBe('VtaLink.YourAgentFallback')
    expect(agentNameInDid('did:webvh:QmVta:dids.example.org:al-signer')).toBe('al-signer')
    expect(agentNameInDid('did:webvh:QmVta:dids.example.org:people:al%20signer')).toBeUndefined()
  })
  it('by the name the agent gave, once read, for that agent only', () => {
    const names = { [vtaDid]: { label: 'runner', source: 'vtaName' as const } }
    expect(agentDisplayName(withAgentName({ vtaDid, label: 'Lab agent' }, names), t)).toBe('runner')
    expect(agentDisplayName(withAgentName({ vtaDid: 'did:webvh:QmB:b.example.org', label: 'B' }, names), t)).toBe('B')
    expect(agentDisplayName(withAgentName({ vtaDid, label: vtaDid }, undefined), t)).toBe('alice')
  })
  it('by what the person named it on this phone, over any name it gives itself', () => {
    const names = { [vtaDid]: { label: 'Work', source: 'nickname' as const } }
    expect(agentDisplayName(withAgentName({ vtaDid, label: 'Lab agent' }, names), t)).toBe('Work')
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
