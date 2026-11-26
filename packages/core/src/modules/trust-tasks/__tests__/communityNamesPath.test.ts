/**
 * The path that names a community says what it did (IN-814): how many names were saved on the phone, and for each
 * read of a community's public profile, that it gave a name or why it gave none. The whole path was silent before,
 * so a report could not tell "no name saved" from "the profile was not answered".
 */
import { act, renderHook } from '@testing-library/react-native'

import { publishedName } from '../module/communityNameRefresh'
import { communityLogRef, namesShownLine } from '../module/communityNamesLog'
import {
  forgetSavedCommunityNamesRead,
  loadSavedCommunityNames,
  useSavedCommunityNames,
} from '../module/savedCommunityNames'
import { readPublicProfile, readPublicProfileName, readPublicProfileOutcome } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:host.example:test-vtc'
const OTHER = 'did:webvh:QmOther000000000000000000000000000000000000:host.example:other-vtc'
const BASE = 'https://vtc.example/v1'
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body }) as never
const fetching = (status: number, body: unknown) => jest.fn(async () => answer(status, body))

describe('a read of a public profile says why it gave no name', () => {
  test('a name: the profile, and nothing missed', async () => {
    const outcome = await readPublicProfileOutcome(
      BASE,
      VTC,
      fetching(200, { communityDid: VTC, name: ' Test VTC ' }) as never
    )
    expect(outcome).toEqual({ profile: { name: 'Test VTC', logoUrl: undefined } })
  })

  test.each([
    ['a status that is not a success', fetching(404, {}), 'HTTP 404'],
    ['a server error', fetching(503, {}), 'HTTP 503'],
    [
      'a profile about another community',
      fetching(200, { communityDid: OTHER, name: 'Other' }),
      "the profile is another community's",
    ],
    ['an answer with no community in it', fetching(200, { name: 'Anyone' }), "the profile is another community's"],
    ['a request that fails', jest.fn(async () => Promise.reject(new Error('offline'))), 'the request failed'],
    [
      'an answer that is not JSON',
      jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => Promise.reject(new Error('<html>')),
      })),
      'the answer is not JSON',
    ],
  ])('%s: no profile, and the reason', async (_case, doFetch, missed) => {
    expect(await readPublicProfileOutcome(BASE, VTC, doFetch as never)).toEqual({ missed })
    // What the two older reads return has not changed: nothing.
    expect(await readPublicProfile(BASE, VTC, doFetch as never)).toBeUndefined()
    expect(await readPublicProfileName(BASE, VTC, doFetch as never)).toBeUndefined()
  })

  test('a profile with an empty name: the profile (its logo may still be used), and that it has no name', async () => {
    const doFetch = fetching(200, { communityDid: VTC, name: '  ', logo_url: 'https://vtc.example/logo.png' })
    expect(await readPublicProfileOutcome(BASE, VTC, doFetch as never)).toEqual({
      profile: { name: undefined, logoUrl: 'https://vtc.example/logo.png' },
      missed: 'the profile has no name',
    })
    expect(await readPublicProfile(BASE, VTC, doFetch as never)).toEqual({
      name: undefined,
      logoUrl: 'https://vtc.example/logo.png',
    })
  })

  test('the name read tells its caller why, and only when it gave none', async () => {
    const told = jest.fn()
    expect(
      await readPublicProfileName(BASE, VTC, fetching(200, { communityDid: VTC, name: 'Test VTC' }) as never, told)
    ).toBe('Test VTC')
    expect(told).not.toHaveBeenCalled()
    expect(await readPublicProfileName(BASE, VTC, fetching(404, {}) as never, told)).toBeUndefined()
    expect(told).toHaveBeenCalledWith('HTTP 404')
  })
})

describe('each read from a screen ends as one log line', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })
  const agentWith = (resolveDidDocument: jest.Mock) => {
    const info = jest.fn()
    return { agent: { dids: { resolveDidDocument }, config: { logger: { info } } } as never, info }
  }
  const documentWith = (service: unknown[]) => jest.fn(async () => ({ service }))
  const REF = communityLogRef(VTC)

  test('named', async () => {
    global.fetch = fetching(200, { communityDid: VTC, name: 'Test VTC' }) as never
    const { agent, info } = agentWith(documentWith([{ type: 'VTCRest', serviceEndpoint: BASE }]))
    expect(await publishedName(agent, VTC)).toBe('Test VTC')
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toMatch(
      new RegExp(`^\\[Community:names\\] ${REF}: named by its public profile \\(\\d+ ms\\)$`)
    )
    // The line says a name was found, never what it is.
    expect(info.mock.calls[0][0]).not.toContain('Test VTC')
  })

  test.each([
    ['the profile is not answered', () => fetching(503, {}), [{ type: 'VTCRest', serviceEndpoint: BASE }], 'HTTP 503'],
    [
      'the profile has no name',
      () => fetching(200, { communityDid: VTC, name: '' }),
      [{ type: 'VTCRest', serviceEndpoint: BASE }],
      'the profile has no name',
    ],
    [
      'its document names no VTCRest service',
      () => fetching(200, {}),
      [{ type: 'Other', serviceEndpoint: BASE }],
      'its DID document names no VTCRest service',
    ],
  ])('not named, %s', async (_case, makeFetch, service, why) => {
    global.fetch = makeFetch() as never
    const { agent, info } = agentWith(documentWith(service))
    expect(await publishedName(agent, VTC)).toBeUndefined()
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toMatch(
      new RegExp(`^\\[Community:names\\] ${REF}: no name from its public profile, ${why} \\(\\d+ ms\\)$`)
    )
  })

  test('not named, its DID document was not resolved: nothing is fetched', async () => {
    global.fetch = jest.fn() as never
    const { agent, info } = agentWith(jest.fn(async () => Promise.reject(new Error('not found'))))
    expect(await publishedName(agent, VTC)).toBeUndefined()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(info.mock.calls[0][0]).toContain('no name from its public profile, its DID document was not resolved')
  })
})

describe('the names saved on the phone are put where the screens read them, once at app start', () => {
  const record = (communityDid: string, name: string) => ({
    content: { communityDid, name, at: '2026-11-25T00:00:00.000Z' },
    getTags: () => ({ recordType: 'keyring/vti-community', kind: 'community-name', key: communityDid }),
    updatedAt: new Date(Date.UTC(2026, 10, 25)),
  })
  const agentHolding = (findAllByQuery: jest.Mock) => {
    const info = jest.fn()
    return {
      agent: { genericRecords: { findAllByQuery, delete: jest.fn() }, config: { logger: { info } } } as never,
      info,
    }
  }
  beforeEach(() => communityTarget.clear())

  test('each saved name is known by its community, and the line says how many', async () => {
    const { agent, info } = agentHolding(jest.fn(async () => [record(VTC, 'Test VTC'), record(OTHER, 'Other')]))
    expect(communityTarget.publishedNameOf(VTC)).toBeUndefined()
    expect(await loadSavedCommunityNames(agent)).toBe(2)
    expect(communityTarget.publishedNameOf(VTC)).toBe('Test VTC')
    expect(communityTarget.publishedNameOf(OTHER)).toBe('Other')
    expect(info).toHaveBeenCalledWith('[Community:names] saved on this phone: 2, loaded')
  })

  test('read once for an agent: callers at once, and callers afterwards, share the one read', async () => {
    const find = jest.fn(async () => [record(VTC, 'Test VTC')])
    const { agent } = agentHolding(find)
    await Promise.all([loadSavedCommunityNames(agent), loadSavedCommunityNames(agent)])
    expect(await loadSavedCommunityNames(agent)).toBe(1)
    expect(find).toHaveBeenCalledTimes(1)
    // Another agent (another wallet) is read for itself.
    const other = agentHolding(jest.fn(async () => []))
    expect(await loadSavedCommunityNames(other.agent)).toBe(0)
    expect(other.agent).not.toBe(agent)
    // As after a start of the app: read again.
    forgetSavedCommunityNamesRead(agent)
    await loadSavedCommunityNames(agent)
    expect(find).toHaveBeenCalledTimes(2)
  })

  test('a read that fails is none, said in the log, never thrown, and not kept: the next caller reads again', async () => {
    const failure = Object.assign(new Error('the wallet is closed'), { name: 'WalletError' })
    const find = jest
      .fn<Promise<unknown[]>, []>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue([record(VTC, 'Test VTC')])
    const { agent, info } = agentHolding(find)
    expect(await loadSavedCommunityNames(agent)).toBe(0)
    expect(info).toHaveBeenCalledWith('[Community:names] saved on this phone: not read (WalletError)')
    // What failed is said by its kind, never by its message.
    expect(info.mock.calls.join(' ')).not.toContain('the wallet is closed')
    expect(await loadSavedCommunityNames(agent)).toBe(1)
    expect(communityTarget.publishedNameOf(VTC)).toBe('Test VTC')
  })

  test('the tab navigator starts the read as soon as there is an agent, and only then', async () => {
    const find = jest.fn(async () => [record(VTC, 'Test VTC')])
    const { agent } = agentHolding(find)
    const started = renderHook(
      ({ with: withAgent }: { with: never | undefined }) => useSavedCommunityNames(withAgent),
      {
        initialProps: { with: undefined as never | undefined },
      }
    )
    await act(async () => undefined)
    expect(find).not.toHaveBeenCalled()
    started.rerender({ with: agent })
    await act(async () => undefined)
    expect(find).toHaveBeenCalledTimes(1)
    expect(communityTarget.publishedNameOf(VTC)).toBe('Test VTC')
    // Drawn again, it reads nothing more.
    started.rerender({ with: agent })
    await act(async () => undefined)
    expect(find).toHaveBeenCalledTimes(1)
  })
})

describe('one number that changes with the names, for a screen that names several communities', () => {
  beforeEach(() => communityTarget.clear())

  test('it changes when a name is learned or replaced, and not when the same name is said again', () => {
    const start = communityTarget.namesLearned()
    communityTarget.publishedName(VTC, 'Test VTC')
    const learned = communityTarget.namesLearned()
    expect(learned).not.toBe(start)
    communityTarget.publishedName(VTC, 'Test VTC')
    communityTarget.publishedName(VTC, '  ')
    expect(communityTarget.namesLearned()).toBe(learned)
    communityTarget.publishedName(VTC, 'Test VTC, renamed')
    expect(communityTarget.namesLearned()).not.toBe(learned)
  })

  test('a screen that listens is told of each change, and it changes when the names are forgotten', () => {
    const told = jest.fn()
    const stop = communityTarget.subscribe(told)
    communityTarget.publishedName(OTHER, 'Other')
    expect(told).toHaveBeenCalledTimes(1)
    const before = communityTarget.namesLearned()
    communityTarget.clear()
    expect(communityTarget.namesLearned()).not.toBe(before)
    stop()
  })
})

test('a screen says how many communities it shows and which have no name, by a short form of each DID', () => {
  expect(namesShownLine('Messages', [VTC, OTHER], [])).toBe('[Community:names] Messages: 2 shown, each with a name')
  expect(namesShownLine('Messages', [VTC, OTHER], [OTHER])).toBe(
    `[Community:names] Messages: 2 shown, 1 with no name on this phone (${communityLogRef(OTHER)})`
  )
  expect(communityLogRef(VTC)).toBe('did:webvh:QmNvAi…test-vtc')
  expect(communityLogRef('did:key:short')).toBe('did:key:short')
})
