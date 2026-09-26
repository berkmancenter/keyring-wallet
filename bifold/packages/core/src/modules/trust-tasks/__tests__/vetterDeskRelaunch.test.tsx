/**
 * A vetter keeps their place across a relaunch. Seen on the 225 gate: the
 * vetter had said the codes match and the applicant's card had arrived; after
 * the app was relaunched the desk said "Card received" and was back at
 * "Compare the codes", because "the codes match" lived only on the screen.
 * A fresh render reads only what was stored, which is what a relaunch sees.
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import VtiVetting from '../screens/VtiVetting'
import { vtaAgent } from '../module/vtaAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const mockUseAgent = useAgent as jest.Mock
const communityDid = 'did:webvh:example:community'
const personaDid = 'did:webvh:example:persona'
const config = { mediatorDid: 'did:peer:2:mediator', communityDid }

type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
const seatedVetter: Rec[] = [
  {
    tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
    content: {
      communityDid,
      vtaDid: 'did:webvh:example:linked-vta',
      did: personaDid,
      contextId: 'vta',
      vtaKeyIds: { signing: 's', keyAgreement: 'k' },
      kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
      createdAt: '2026-09-23T00:00:00Z',
    },
  },
  {
    tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'urn:uuid:grant' },
    content: {
      kind: 'vetter-grant',
      communityDid,
      subjectDid: personaDid,
      credential: { id: 'urn:uuid:grant', issuer: communityDid },
      receivedAt: '2026-09-23T00:00:00Z',
    },
  },
]
/** A request whose card has arrived, as the desk stored it. */
const cardIn = (extra: Record<string, unknown> = {}): Rec => ({
  tags: { recordType: 'keyring/vti-vetting', kind: 'desk', key: 'r1' },
  content: {
    requestId: 'r1',
    applicantDid: 'did:key:z6MkApplicant',
    communityDid,
    status: 'cardReceived',
    receivedAt: '2026-09-26T09:00:00Z',
    session: {
      documentId: 'urn:uuid:session',
      challenge: 'c',
      domain: communityDid,
      requiredClaims: ['name.legal'],
      method: 'inPerson',
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      matchCode: 'PBWW-HACW',
    },
    card: { claims: [{ type: 'name.legal', value: 'Gate Applicant' }] },
    ...extra,
  },
})

const agentWith = (records: Rec[]) => ({
  agent: {
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) =>
        records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map((r) => ({ ...r, id: 'x' })),
      save: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
    dids: { resolveDidDocument: async () => Promise.reject(new Error('offline')) },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  },
})

describe('a vetter keeps their place across a relaunch', () => {
  beforeEach(() => {
    const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:linked-vta',
        label: 'alice',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })

  const relaunch = (records: Rec[]) => {
    mockUseAgent.mockReturnValue(agentWith(records))
    return render(
      <BasicAppContext>
        <VtiVetting config={config} />
      </BasicAppContext>
    )
  }

  test('codes confirmed and the card in: the desk opens on checking the card', async () => {
    const tree = relaunch([...seatedVetter, cardIn({ matchConfirmedAt: '2026-09-26T09:01:00Z' })])
    expect(await tree.findByTestId(testIdWithKey('VettingVetterStep_check'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('VettingVetterStep_match'))).toBeNull()
  })

  test('the card in but the codes not yet confirmed here: the vetter still compares them', async () => {
    const tree = relaunch([...seatedVetter, cardIn()])
    expect(await tree.findByTestId(testIdWithKey('VettingVetterStep_match'))).toBeTruthy()
  })

  test('comparing the codes: the answers sit under the code, not under the tab bar', async () => {
    // On a 6.3" phone (402×874 pt) the 56 pt code wrapped and "Codes match"
    // fell under the tab bar (225 gate): the code is one line at 40 pt, and
    // the seat banner keeps its title and badge but drops its sentence.
    const tree = relaunch([...seatedVetter, cardIn()])
    const code = await tree.findByTestId(testIdWithKey('VettingMatchCode'))
    expect(StyleSheet.flatten(code.props.style).fontSize).toBeLessThanOrEqual(40)
    expect(code.props.numberOfLines).toBe(1)
    expect(tree.getByTestId(testIdWithKey('VettingRoleBadge'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('VettingSeatHint'))).toBeNull()
  })
})
