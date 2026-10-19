/**
 * A request is never sent under a community's directory statement the person
 * was not shown (join manifest/0.4, tf#823): not on Join, not under a changed
 * statement. The statement is shown in words, the community's text as text,
 * every audience as a maximum.
 */
import { render } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'

const mockApply = jest.fn()
const mockManifest = jest.fn()

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    client: () => ({
      ensurePersona: async () => ({
        did: 'did:webvh:p:me',
        communityDid: 'did:webvh:c:dir',
        kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
      }),
    }),
  },
}))
jest.mock('../module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../module/vtiAgent', () => {
  const actual = jest.requireActual('../module/vtiAgent')
  return {
    ...actual,
    vtiAgent: {
      connect: async () => undefined,
      onInbound: () => () => undefined,
      fetchManifest: (...args: unknown[]) => mockManifest(...args),
      apply: (...args: unknown[]) => mockApply(...args),
    },
  }
})

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import {
  DisclosureNotShown,
  MalformedDisclosure,
  readDirectoryDisclosure,
  readShownThenConfirm,
} from '../module/directoryDisclosure'
import { joinCommunity } from '../module/vtiJoin'
import { DirectoryDisclosureCard, durationWords } from '../screens/DirectoryDisclosureCard'
import { plainError } from '../screens/plainError'

import { statement } from './fixtures/directoryStatement'

const COMMUNITY = 'did:webvh:c:dir'
const disclosure = () => readDirectoryDisclosure(statement())

function store() {
  let submission: Record<string, unknown> | undefined
  return {
    saveSubmission: jest.fn(async (s: Record<string, unknown>) => {
      submission = s
    }),
    getSubmission: jest.fn(async () => submission),
    getMembership: jest.fn(async () => undefined),
  }
}
const deps = (communityStore: ReturnType<typeof store>, disclosureSeen?: string) =>
  ({
    agent: { config: { logger: { warn: jest.fn(), info: jest.fn() } } },
    identityStore: {},
    communityStore,
    vtaDid: 'did:webvh:vta',
    mediatorDid: 'did:peer:lab',
    communityDid: COMMUNITY,
    disclosureSeen,
  }) as never

describe('joining under a directory statement', () => {
  beforeEach(() => {
    mockApply.mockReset()
    mockManifest.mockResolvedValue({
      wire: '0.3',
      manifestWire: '0.4',
      criteria: [],
      directoryDisclosure: disclosure(),
    })
  })

  it.each([
    ['none was shown', undefined],
    ['another statement was shown', 'zQmAnEarlierStatement'],
  ])('is not sent when %s, and nothing is recorded as sent', async (_, seen) => {
    const communityStore = store()
    await expect(joinCommunity(deps(communityStore, seen))).rejects.toBeInstanceOf(DisclosureNotShown)
    expect(mockApply).not.toHaveBeenCalled()
    expect(communityStore.saveSubmission).not.toHaveBeenCalled()
  })

  it('is sent when this exact statement was shown, and the record keeps its digest', async () => {
    const communityStore = store()
    mockApply.mockResolvedValue({ effect: 'refer', requestId: 'r-1', needs: [] })
    await joinCommunity(deps(communityStore, statement().statementDigest))
    expect(mockApply.mock.calls[0][2]).toMatchObject({ disclosureSeen: statement().statementDigest })
    expect(communityStore.saveSubmission.mock.calls[0][0]).toMatchObject({
      directoryStatementDigest: statement().statementDigest,
    })
  })

  it('a community with no statement is joined as before', async () => {
    mockManifest.mockResolvedValue({ wire: '0.3', criteria: [] })
    mockApply.mockResolvedValue({ effect: 'refer', requestId: 'r-1', needs: [] })
    await joinCommunity(deps(store()))
    expect(mockApply).toHaveBeenCalled()
  })
})

describe('what a person is told', () => {
  it('a statement that cannot be read, and one not shown yet, each in its own words, neither retried', () => {
    expect(plainError(new MalformedDisclosure('adminNotes is missing'))).toMatchObject({
      line: 'Errors.DirectoryUnreadable',
      retry: false,
    })
    expect(plainError(new DisclosureNotShown('zQm'))).toMatchObject({ line: 'Errors.DirectoryNotShown', retry: false })
  })
})

describe('the statement in words', () => {
  it('every field, the community’s own text kept as text, and each other line', () => {
    const tree = render(
      <BasicAppContext>
        <DirectoryDisclosureCard disclosure={disclosure()} community="Test VTC" />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('DirectoryDisclosure'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('DirectoryDisclosureField_0'))).toHaveTextContent(/Name/)
    // Markup in the community's words is shown as written, never rendered.
    expect(tree.getByTestId(testIdWithKey('DirectoryDisclosureField_1'))).toHaveTextContent(
      /What the <b>admins<\/b> say you do/
    )
    for (const line of ['NewCard', 'Did', 'Notes', 'Groups', 'External']) {
      expect(tree.getByTestId(testIdWithKey(`DirectoryDisclosure${line}`))).toBeTruthy()
    }
  })

  it('says nothing about groups when the community has none', () => {
    const { groups: _groups, ...without } = disclosure()
    const tree = render(
      <BasicAppContext>
        <DirectoryDisclosureCard disclosure={without} community="Test VTC" />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey('DirectoryDisclosureGroups'))).toBeNull()
  })

  it('a validity in words, and anything else as given', () => {
    const t = ((key: string, o?: { count?: number }) => `${o?.count} ${key.split('.').pop()}`) as unknown as TFunction
    expect(durationWords('P30D', t)).toBe('30 days')
    expect(durationWords('P2WT12H', t)).toBe('2 weeks, 12 hours')
    expect(durationWords('P1Y', t)).toBe('P1Y')
  })
})

describe('the order a screen sends in: read, check, then confirm (vetting’s Apply)', () => {
  const withStatement = { directoryDisclosure: { statementDigest: 'zQmCurrent' } }

  it('never asks for a confirmation for a request that will not be sent', async () => {
    const confirm = jest.fn(async () => true)
    await expect(readShownThenConfirm(undefined, async () => withStatement, confirm)).rejects.toBeInstanceOf(
      DisclosureNotShown
    )
    await expect(readShownThenConfirm('zQmEarlier', async () => withStatement, confirm)).rejects.toBeInstanceOf(
      DisclosureNotShown
    )
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks once the statement is the one shown, and sends nothing when declined', async () => {
    const confirm = jest.fn(async () => true)
    await expect(readShownThenConfirm('zQmCurrent', async () => withStatement, confirm)).resolves.toBe(withStatement)
    expect(confirm).toHaveBeenCalledTimes(1)
    await expect(
      readShownThenConfirm(
        'zQmCurrent',
        async () => withStatement,
        async () => false
      )
    ).resolves.toBeUndefined()
    await expect(
      readShownThenConfirm(
        undefined,
        async () => ({}),
        async () => true
      )
    ).resolves.toEqual({})
  })
})
