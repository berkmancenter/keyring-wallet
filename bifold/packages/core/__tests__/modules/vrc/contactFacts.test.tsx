/**
 * What this phone knows about a contact, read once and kept (UI-smoothness plan, Phase 4). Not read yet is not "no
 * name" and not "not verified": a screen shows nothing for a fact until it is known, and never a name or a badge that
 * pops in. The name and photo come from one read of the relationship records (the name cache read them again for
 * each relationship), and hardware evidence is verified once and shared by every screen.
 */
import { useAgent } from '@bifold/react-hooks'
import { act, renderHook } from '@testing-library/react-native'
import React, { useLayoutEffect } from 'react'

import {
  contactFacts,
  knownName,
  useConnectionFacts,
  useContactFacts,
} from '../../../src/modules/vrc/contacts/useContactFacts'

// jestSetup replaces the provider with a passthrough for every suite; this one tests the real one.
const { VrcNameCacheProvider, useVrcNameCache } = jest.requireActual(
  '../../../src/modules/vrc/context/VrcNameCacheProvider'
) as typeof import('../../../src/modules/vrc/context/VrcNameCacheProvider')

jest.mock('@bifold/react-hooks')
let mockAgent: unknown = undefined
jest.mock('../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  useOpenIDCredentials: () => ({ openIdState: { w3cCredentialRecords: mockRecords } }),
}))
const mockRecords: unknown[] = []

/** What each relationship's cards say, set per test. */
let mockDisplay: Record<string, { name?: string; photo?: string }> = {}
/** Each relationship's credential, and whether it carries hardware evidence. */
let mockCredential: Record<string, { id: string; evidence: boolean } | undefined> = {}
const mockVerify = jest.fn(async (_credential: unknown): Promise<{ valid: boolean } | null> => ({ valid: true }))

jest.mock('../../../src/modules/vrc/utils/rcardDisplayUtils', () => ({
  resolveContactDisplayInfo: (_records: unknown, did: string) => mockDisplay[did] ?? {},
}))
jest.mock('../../../src/modules/vrc/utils/witnessCredentialUtils', () => ({
  getVrcCredentialJsonForSubject: (_records: unknown, did: string) => {
    const c = mockCredential[did]
    return c ? { id: c.id } : null
  },
  hasVrcHardwareAttestation: (_records: unknown, did: string) => Boolean(mockCredential[did]?.evidence),
}))
jest.mock('../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: (credential: unknown) => mockVerify(credential),
}))

type Rel = { connectionId?: string; counterpartyRelationshipDid?: string }
function fakeAgent(relationships: Rel[]) {
  const getAll = jest.fn(async () => relationships)
  return { agent: { context: {}, dependencyManager: { resolve: () => ({ getAll }) } } as never, getAll }
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  contactFacts.forget()
  mockDisplay = {}
  mockCredential = {}
  mockVerify.mockClear()
  mockVerify.mockImplementation(async () => ({ valid: true }))
})

describe('a contact name, read or not', () => {
  it('knownName: undefined both before it is read and when it was read as absent; the name once read', () => {
    expect(knownName({ known: false })).toBeUndefined()
    expect(knownName({ known: true, value: undefined })).toBeUndefined()
    expect(knownName({ known: true, value: 'Ada' })).toBe('Ada')
  })
})

describe("a connection's facts", () => {
  it('one read of the relationships for every connection; not read until it lands, then each one known', async () => {
    mockDisplay = { 'did:a': { name: 'Ada', photo: 'data:image/jpeg;base64,AA' }, 'did:b': {} }
    const { agent, getAll } = fakeAgent([
      { connectionId: 'c-a', counterpartyRelationshipDid: 'did:a' },
      { connectionId: 'c-b', counterpartyRelationshipDid: 'did:b' },
      { connectionId: 'c-c', counterpartyRelationshipDid: 'did:c' },
    ])
    const { result } = renderHook(() => useConnectionFacts('c-a'))
    expect(result.current.name).toEqual({ known: false })
    expect(result.current.photo).toEqual({ known: false })
    await act(async () => contactFacts.load(agent, []))
    expect(getAll).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({
      name: { known: true, value: 'Ada' },
      photo: { known: true, value: 'data:image/jpeg;base64,AA' },
    })
    // Read, with no name and no photo: known absent — the one case that may say "Unnamed contact".
    expect(contactFacts.connection('c-b')).toEqual({
      name: { known: true, value: undefined },
      photo: { known: true, value: undefined },
    })
    // A connection with no relationship at all: known absent too, once read.
    expect(contactFacts.connection('c-none').name).toEqual({ known: true, value: undefined })
  })

  it('only the newest read lands: an older one finishing late does not put back what was before', async () => {
    mockDisplay = { 'did:a': { name: 'Old' } }
    let releaseOld: () => void = () => undefined
    const old = {
      context: {},
      dependencyManager: {
        resolve: () => ({
          getAll: () =>
            new Promise((r) => (releaseOld = () => r([{ connectionId: 'c-a', counterpartyRelationshipDid: 'did:a' }]))),
        }),
      },
    } as never
    const first = contactFacts.load(old, [])
    mockDisplay = { 'did:a': { name: 'New' } }
    await contactFacts.load(fakeAgent([{ connectionId: 'c-a', counterpartyRelationshipDid: 'did:a' }]).agent, [])
    mockDisplay = { 'did:a': { name: 'Old' } }
    releaseOld()
    await first
    expect(knownName(contactFacts.connection('c-a').name)).toBe('New')
  })

  it('the same facts are the same object: no re-render without a change', async () => {
    await contactFacts.load(fakeAgent([{ connectionId: 'c-a', counterpartyRelationshipDid: 'did:a' }]).agent, [])
    let renders = 0
    renderHook(() => {
      renders++
      return useConnectionFacts('c-a')
    })
    await settle()
    expect(renders).toBe(1)
  })
})

describe("a contact's hardware verification", () => {
  /** A contact's facts, with every committed frame's hwVerified kept in order. */
  function contactOver(dids: string[]) {
    const frames: unknown[] = []
    const hook = renderHook(() => {
      const facts = useContactFacts(dids)
      useLayoutEffect(() => {
        frames.push(facts.hwVerified)
      })
      return facts
    })
    return { ...hook, frames }
  }
  const relationships = (dids: string[]) =>
    dids.map((d, i) => ({ connectionId: `c-${i}`, counterpartyRelationshipDid: d }))

  it('evidence that verifies: not known while it is checked, then verified — never "not verified" first', async () => {
    mockCredential = { 'did:a': { id: 'urn:vrc:a', evidence: true } }
    let answer: (v: { valid: boolean }) => void = () => undefined
    mockVerify.mockImplementation(() => new Promise((r) => (answer = r)))
    await contactFacts.load(fakeAgent(relationships(['did:a'])).agent, [])
    const { result, frames } = contactOver(['did:a'])
    await settle()
    expect(result.current.hwVerified).toEqual({ known: false })
    await act(async () => answer({ valid: true }))
    expect(result.current.hwVerified).toEqual({ known: true, value: true })
    expect(frames).not.toContainEqual({ known: true, value: false })
  })

  it('no hardware evidence: not verified at once, with nothing to check', async () => {
    mockCredential = { 'did:a': { id: 'urn:vrc:a', evidence: false } }
    await contactFacts.load(fakeAgent(relationships(['did:a'])).agent, [])
    const { result } = contactOver(['did:a'])
    await settle()
    expect(result.current.hwVerified).toEqual({ known: true, value: false })
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('checked once and shared: a second screen on the same contact does not verify again', async () => {
    mockCredential = { 'did:a': { id: 'urn:vrc:a', evidence: true } }
    let answer: (v: { valid: boolean }) => void = () => undefined
    mockVerify.mockImplementation(() => new Promise((r) => (answer = r)))
    await contactFacts.load(fakeAgent(relationships(['did:a'])).agent, [])
    // The list asks; the contact's page opens while that check is still out, and shares it.
    const list = contactOver(['did:a'])
    await settle()
    const page = contactOver(['did:a'])
    await settle()
    await act(async () => answer({ valid: true }))
    // And once known, a third screen reads it with no check at all.
    contactOver(['did:a'])
    await settle()
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(page.result.current.hwVerified).toEqual({ known: true, value: true })
    expect(list.result.current.hwVerified).toEqual({ known: true, value: true })
  })

  it('a new credential for the relationship is checked again', async () => {
    mockCredential = { 'did:a': { id: 'urn:vrc:a1', evidence: true } }
    await contactFacts.load(fakeAgent(relationships(['did:a'])).agent, [])
    contactOver(['did:a'])
    await settle()
    mockCredential = { 'did:a': { id: 'urn:vrc:a2', evidence: true } }
    await act(async () => contactFacts.load(fakeAgent(relationships(['did:a'])).agent, []))
    expect(contactFacts.hardware('did:a')).toEqual({ known: false })
    contactOver(['did:a'])
    await settle()
    expect(mockVerify).toHaveBeenCalledTimes(2)
  })

  it('over several relationships: verified when one verifies; not verified only when every one is known not to', async () => {
    mockCredential = {
      'did:a': { id: 'urn:vrc:a', evidence: false },
      'did:b': { id: 'urn:vrc:b', evidence: true },
    }
    let answer: (v: { valid: boolean }) => void = () => undefined
    mockVerify.mockImplementation(() => new Promise((r) => (answer = r)))
    await contactFacts.load(fakeAgent(relationships(['did:a', 'did:b'])).agent, [])
    const { result } = contactOver(['did:a', 'did:b'])
    await settle()
    // a is known not to; b is still being checked: not known.
    expect(result.current.hwVerified).toEqual({ known: false })
    await act(async () => answer({ valid: false }))
    expect(result.current.hwVerified).toEqual({ known: true, value: false })
  })

  it('a check that throws is "not verified", as the screens took it', async () => {
    mockCredential = { 'did:a': { id: 'urn:vrc:a', evidence: true } }
    mockVerify.mockImplementation(async () => {
      throw new Error('native verifier unavailable')
    })
    await contactFacts.load(fakeAgent(relationships(['did:a'])).agent, [])
    const { result } = contactOver(['did:a'])
    await settle()
    await settle()
    expect(result.current.hwVerified).toEqual({ known: true, value: false })
  })
})

describe('the name cache, read from the facts (its API unchanged)', () => {
  const wrapper = ({ children }: React.PropsWithChildren) => <VrcNameCacheProvider>{children}</VrcNameCacheProvider>
  beforeEach(() => {
    ;(useAgent as jest.Mock).mockImplementation(() => ({ agent: mockAgent }))
  })
  afterEach(() => {
    mockAgent = undefined
  })

  it('loading until the first read lands; then the name, and null for a connection with none', async () => {
    mockDisplay = { 'did:a': { name: 'Ada' } }
    let release: () => void = () => undefined
    const getAll = jest.fn(
      () =>
        new Promise(
          (resolve) => (release = () => resolve([{ connectionId: 'c-a', counterpartyRelationshipDid: 'did:a' }]))
        )
    )
    mockAgent = { context: {}, dependencyManager: { resolve: () => ({ getAll }) } }
    const { result } = renderHook(() => useVrcNameCache(), { wrapper })
    await settle()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.getVrcName('c-a')).toBeNull()
    await act(async () => release())
    await settle()
    expect(getAll).toHaveBeenCalledTimes(1)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.getVrcName('c-a')).toBe('Ada')
    expect(result.current.getVrcName('c-none')).toBeNull()
  })

  it('no agent: nothing known, and not loading', async () => {
    mockDisplay = { 'did:a': { name: 'Ada' } }
    await contactFacts.load(fakeAgent([{ connectionId: 'c-a', counterpartyRelationshipDid: 'did:a' }]).agent, [])
    mockAgent = undefined
    const { result } = renderHook(() => useVrcNameCache(), { wrapper })
    await settle()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.getVrcName('c-a')).toBeNull()
  })
})
