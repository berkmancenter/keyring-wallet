/**
 * A new memory (C3): the `entries/create` payload is exactly the brief's object and validates against the vendored
 * schema; text out of bounds sends nothing; the outcome of the call is read as the brief says.
 */
import {
  addHcpMemory,
  hcpCreatePayload,
  HCP_MEMORY_MAX_CHARS,
  HCP_NO_ENTRY,
  type HcpNewMemoryInput,
} from '../newMemory'
import { HCP_ENTRIES_CREATE } from '../types'
import type { HcpVtaPort } from '../vtaPort'
import { expectValid, hcpSchemas } from './fixtures/hcpSchemas'

const S = hcpSchemas()
const MANAGER = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const NOW = new Date('2026-11-27T10:30:00.000Z')

const input = (change: Partial<HcpNewMemoryInput> = {}): HcpNewMemoryInput => ({
  text: '  I prefer replies in short sentences.\n',
  language: 'en',
  managerDid: MANAGER,
  now: NOW,
  ...change,
})

/** The entry the VTA answers with: a whole Entry, the provider-assigned members filled in. */
const createdEntry = () => ({
  schema: 'https://hcp.example/spec/entry/2.0',
  id: 'urn:uuid:9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
  type: ['ContextEntry'],
  subject: { id: MANAGER },
  content: {
    profile: 'https://hcp.example/spec/profiles/general-context/2.0',
    value: 'I prefer replies in short sentences.',
    language: 'en',
  },
  assertion: { declarationType: 'person-declared' },
  classification: { categories: ['general_preferences'] },
  record: {
    status: 'active',
    version: 1,
    provenance: {
      assertedBy: { id: MANAGER, assurance: 'cryptographically-verified' },
      assertedAt: '2026-11-27T10:30:00.000Z',
      source: 'person-input',
      submittedByClient: { id: MANAGER, name: 'Keyring', operator: { id: MANAGER, name: 'The person' } },
      authorizedUnder: 'management',
      recordedByProvider: 'did:web:vta.example',
      recordedAt: '2026-11-27T10:30:01.000Z',
    },
  },
})

/** The port, and a VTA session whose state's `managerDid` is `manager` (read at each call). */
function fakePort(answer: () => Promise<unknown>, manager: { did?: string } = { did: MANAGER }) {
  const task = jest.fn((_type: string, _payload: Record<string, unknown>) => answer())
  const getState = jest.fn(() => ({ managerDid: manager.did }))
  return { deps: { port: { task } as HcpVtaPort, session: { getState } }, task, getState, manager }
}

/** What the screen gives: the input without the manager DID. */
const screenInput = (change: Partial<HcpNewMemoryInput> = {}) => {
  const { managerDid: _ignored, ...rest } = input(change)
  return rest
}

/** The brief's object ("A new memory (C3)") for `input()`. */
const briefObject = () => ({
  schema: 'https://hcp.example/spec/entry/2.0',
  subject: { id: MANAGER },
  content: {
    profile: 'https://hcp.example/spec/profiles/general-context/2.0',
    value: 'I prefer replies in short sentences.',
    language: 'en',
  },
  classification: { categories: ['general_preferences'] },
  assertion: { declarationType: 'person-declared' },
  record: {
    provenance: { source: 'person-input', assertedBy: { id: MANAGER }, assertedAt: '2026-11-27T10:30:00.000Z' },
  },
})

describe('hcpCreatePayload', () => {
  it('is exactly the brief object, with the text trimmed', () => {
    expect(hcpCreatePayload(input())).toStrictEqual(briefObject())
  })

  it('validates against the vendored entries/create schema, in each app language, without accessToken', () => {
    for (const language of ['en', 'fr', 'pt-BR'] as const) {
      const payload = hcpCreatePayload(input({ language }))
      expect(payload).not.toHaveProperty('accessToken')
      expectValid(S[HCP_ENTRIES_CREATE].request, payload)
    }
  })

  // control: a model-inferred memory fails the exactness test above, though the schema alone would take it (it does
  // not check that a model-inferred assertion carries a confidence).
  it('control: the payload with declarationType "model-inferred" fails the exactness test', () => {
    const inferred = { ...hcpCreatePayload(input()), assertion: { declarationType: 'model-inferred' } }
    expect(() => expect(inferred).toStrictEqual(briefObject())).toThrow()
    expect(S[HCP_ENTRIES_CREATE].request(inferred)).toBe(true)
  })
})

describe('addHcpMemory', () => {
  it('sends entries/create once with the payload, and succeeds on a response with entry', async () => {
    const entry = createdEntry()
    expectValid(S[HCP_ENTRIES_CREATE].response, { entry })
    const { deps, task } = fakePort(async () => ({ entry }))
    expect(await addHcpMemory(deps, screenInput())).toEqual({ ok: true, entry })
    expect(task).toHaveBeenCalledTimes(1)
    expect(task).toHaveBeenCalledWith(HCP_ENTRIES_CREATE, hcpCreatePayload(input()))
  })

  it('sends nothing for empty text, text of only spaces, or 4097 characters', async () => {
    const { deps, task } = fakePort(async () => ({ entry: createdEntry() }))
    for (const text of ['', '   \n\t', 'a'.repeat(HCP_MEMORY_MAX_CHARS + 1)]) {
      expect(await addHcpMemory(deps, screenInput({ text }))).toEqual({ ok: false, invalid: true })
    }
    expect(task).not.toHaveBeenCalled()
  })

  // control: the opposite of the case above, at the bounds.
  it('control: one character, and 4096 (counting a character outside the BMP as one), are sent', async () => {
    const { deps, task } = fakePort(async () => ({ entry: createdEntry() }))
    expect((await addHcpMemory(deps, screenInput({ text: 'a' }))).ok).toBe(true)
    expect((await addHcpMemory(deps, screenInput({ text: '😀'.repeat(HCP_MEMORY_MAX_CHARS) }))).ok).toBe(true)
    expect((await addHcpMemory(deps, screenInput({ text: ` ${'a'.repeat(HCP_MEMORY_MAX_CHARS)} ` }))).ok).toBe(true)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('unreachable gives MemoryNotSaved; a refusal gives its code and MemoryRefused; no entry is refused', async () => {
    expect(
      await addHcpMemory(
        fakePort(async () => {
          throw new Error('socket closed')
        }).deps,
        screenInput()
      )
    ).toEqual({ ok: false, unreachable: true, message: { key: 'MemoryNotSaved' } })
    expect(
      await addHcpMemory(
        fakePort(async () => {
          throw Object.assign(new Error('no'), { name: 'VtiRefusal', code: 'permissionDenied' })
        }).deps,
        screenInput()
      )
    ).toEqual({ ok: false, refused: 'permissionDenied', message: { key: 'MemoryRefused' } })
    expect(await addHcpMemory(fakePort(async () => ({})).deps, screenInput())).toEqual({
      ok: false,
      refused: HCP_NO_ENTRY,
      message: { key: 'MemoryRefused' },
    })
  })

  it('reads the manager DID from the session at each save, so a rotated key is followed', async () => {
    const { deps, task, getState, manager } = fakePort(async () => ({ entry: createdEntry() }))
    await addHcpMemory(deps, screenInput())
    const ROTATED = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
    manager.did = ROTATED
    await addHcpMemory(deps, screenInput())
    expect(getState).toHaveBeenCalledTimes(2)
    expect(task.mock.calls[0][1]).toStrictEqual(hcpCreatePayload(input()))
    expect(task.mock.calls[1][1]).toStrictEqual(hcpCreatePayload(input({ managerDid: ROTATED })))
  })

  it('with no manager DID on the session, sends nothing and gives MemoryNotSaved, never a subject of undefined', async () => {
    for (const did of [undefined, '']) {
      const { deps, task } = fakePort(async () => ({ entry: createdEntry() }), { did })
      expect(await addHcpMemory(deps, screenInput())).toEqual({
        ok: false,
        noManager: true,
        message: { key: 'MemoryNotSaved' },
      })
      expect(task).not.toHaveBeenCalled()
    }
  })

  it('takes no manager DID from the screen: one passed in anyway is not used', async () => {
    const { deps, task } = fakePort(async () => ({ entry: createdEntry() }))
    const sneaked = { ...screenInput(), managerDid: 'did:key:z6MkNotThePhone' } as unknown as Parameters<
      typeof addHcpMemory
    >[1]
    await addHcpMemory(deps, sneaked)
    expect(task.mock.calls[0][1]).toStrictEqual(hcpCreatePayload(input()))
  })
})
