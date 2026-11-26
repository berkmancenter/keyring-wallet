/**
 * Memories for agent connect (plan §3.15, §2.6, §7.7). The count's every request and every answer the fake VTA gives
 * are validated against `vta/memory/list/0.3`'s own schema at the pin (`fixtures/memory-list-0.3`,
 * `dtgwg-trust-tasks-tf` 2a66a0351), so neither side can take a shape the VTA would not.
 */
import Ajv from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { expectNoDrift, registryPath } from '../../trust-tasks/__tests__/fixtures/registryDrift'
import {
  connectGuard,
  countMemory,
  countNotice,
  createMemory,
  isUnrestrictedAdministrator,
  MEMORY_COUNT_MAX_PAGES,
  MEMORY_COUNT_WARNING,
  MEMORY_LIST_TASK,
  MemoryPort,
  pickerMemories,
  randomContextSuffix,
} from '../memories'

const DIR = join(__dirname, 'fixtures', 'memory-list-0.3')
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, unknown>

/** Each schema registered under the URL its referrer's `$ref` resolves to (the registry's `$id`s do not match its paths). */
function schemas() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  const under = (file: string, url: string) => {
    const s = { ...read(file) }
    delete s.$id
    ajv.addSchema(s, url)
  }
  const record = new URL('../../../_shared/0.1/memory-record.schema.json', MEMORY_LIST_TASK).href
  const acl = new URL('../../../acl/_shared/0.3/acl-entry.schema.json', record).href
  under('memory-record-0.1.schema.json', record)
  under('acl-entry-0.3.schema.json', acl)
  under('framework-0.2.schema.json', new URL('../../../../_framework/0.2/framework.schema.json', MEMORY_LIST_TASK).href)
  under('framework-0.4.schema.json', new URL('../../../_framework/0.4/framework.schema.json', acl).href)
  ajv.addSchema(read('vta-memory-list-0.3.payload.schema.json'))
  const request = ajv.getSchema(MEMORY_LIST_TASK)
  if (!request) throw new Error('no schema for vta/memory/list/0.3')
  return { request, response: ajv.compile({ $ref: `${MEMORY_LIST_TASK}#/$defs/Response` }) }
}
const S = schemas()

function expectValid(validate: (v: unknown) => boolean, value: unknown) {
  if (!validate(value)) throw new Error(JSON.stringify((validate as { errors?: unknown }).errors, null, 1))
}

const item = (key: string, updatedAt: string, deleted = false) => ({
  contextId: 'keyring-memory-educat1on',
  key,
  version: 1,
  deleted,
  updatedAt,
  valueBytes: 12,
})

/** A fake VTA answering `vta/memory/list/0.3` from pages of items, each request and answer held to the schema. */
function memoryVta(pages: ReturnType<typeof item>[][], edit: (a: Record<string, unknown>) => unknown = (a) => a) {
  const sent: Record<string, unknown>[] = []
  const port: Pick<MemoryPort, 'task'> = {
    async task(type, payload) {
      expect(type).toBe(MEMORY_LIST_TASK)
      expectValid(S.request, payload)
      sent.push(payload)
      const index = payload.cursor === undefined ? 0 : Number(String(payload.cursor).slice(1))
      const answer = edit({
        items: pages[index] ?? [],
        highWatermark: 99,
        ...(index + 1 < pages.length ? { nextCursor: `c${index + 1}` } : {}),
      })
      if (answer instanceof Error) throw answer
      expectValid(S.response, answer)
      return answer
    },
  }
  return { port, sent }
}

const bytes = (fill: number) => (n: number) => new Uint8Array(n).fill(fill)

describe('isUnrestrictedAdministrator (§3.15, step 0.1(p))', () => {
  it('admin with no scopes, as the lab recorded it', () => {
    expect(isUnrestrictedAdministrator({ roles: ['admin'], scopes: [] })).toBe(true)
    expect(isUnrestrictedAdministrator({ roles: ['admin'] })).toBe(true)
  })

  it('a scoped administrator, another role, or no answer is not', () => {
    expect(isUnrestrictedAdministrator({ roles: ['admin'], scopes: ['ctx:keyring'] })).toBe(false)
    expect(isUnrestrictedAdministrator({ roles: ['application'], scopes: [] })).toBe(false)
    expect(isUnrestrictedAdministrator({})).toBe(false)
    expect(isUnrestrictedAdministrator(undefined)).toBe(false)
  })

  it('connectGuard: ok, notAdministrator, or unreachable when whoami fails', async () => {
    expect(await connectGuard({ whoAmI: async () => ({ roles: ['admin'], scopes: [] }) })).toBe('ok')
    expect(await connectGuard({ whoAmI: async () => ({ roles: ['admin'], scopes: ['ctx:x'] }) })).toBe(
      'notAdministrator'
    )
    expect(
      await connectGuard({
        whoAmI: async () => {
          throw new Error('timeout')
        },
      })
    ).toBe('unreachable')
  })
})

describe('pickerMemories (§3.15, §6)', () => {
  const contexts = [
    { id: 'vta', name: 'Default' },
    { id: 'keyring', name: 'Keyring personas' },
    { id: 'keyring/child', name: 'Under the persona context' },
    { id: 'keyring-agent-abcdefghij', name: 'Notes helper' },
    { id: 'keyring-memory-hea1thcar', name: 'Healthcare' },
    { id: 'keyring-memory-educat1on', name: 'Education' },
    { id: 'work', name: 'Work' },
    { id: 'work/projects', name: 'Projects' },
    { id: 'no-name' },
  ]

  it('offers memories by name, sorted, never the persona, default or agent contexts, nor one with no name', async () => {
    const memories = await pickerMemories({ listContexts: async () => contexts })
    expect(memories.map((m) => m.name)).toEqual(['Education', 'Healthcare', 'Projects', 'Work'])
  })

  it('greys a context that contains another, whose id is its own and "/" (step 0.1(o))', async () => {
    const memories = await pickerMemories({ listContexts: async () => contexts })
    expect(memories.find((m) => m.id === 'work')?.containsOthers).toBe(true)
    expect(memories.find((m) => m.id === 'work/projects')?.containsOthers).toBe(false)
    expect(memories.find((m) => m.id === 'keyring-memory-educat1on')?.containsOthers).toBe(false)
  })
})

describe('createMemory (§3.15, D35)', () => {
  it('creates keyring-memory-<10 base32> named as typed, the id derived from nothing', async () => {
    const created: { id: string; name: string }[] = []
    const result = await createMemory(
      { listContexts: async () => [], createContext: async (id, name) => created.push({ id, name }) },
      '  Healthcare ',
      bytes(3)
    )
    expect(result).toEqual({ ok: true, memory: { id: 'keyring-memory-dddddddddd', name: 'Healthcare' } })
    expect(created).toEqual([{ id: 'keyring-memory-dddddddddd', name: 'Healthcare' }])
    expect(randomContextSuffix(bytes(31))).toMatch(/^[a-z2-7]{10}$/)
  })

  it('a name another memory has, ignoring case, is refused before anything is created', async () => {
    const create = jest.fn()
    const result = await createMemory(
      { listContexts: async () => [{ id: 'keyring-memory-x', name: 'healthcare' }], createContext: create },
      'Healthcare',
      bytes(3)
    )
    expect(result).toEqual({ ok: false, code: 'duplicateName' })
    expect(create).not.toHaveBeenCalled()
  })

  it('control: the same name on the persona context is not a memory and does not block', async () => {
    const result = await createMemory(
      { listContexts: async () => [{ id: 'keyring', name: 'Healthcare' }], createContext: async () => undefined },
      'Healthcare',
      bytes(3)
    )
    expect(result.ok).toBe(true)
  })

  it('an id that collides is redrawn; a create refused for another reason fails', async () => {
    let draws = 0
    const random = (n: number) => new Uint8Array(n).fill(draws++ === 0 ? 1 : 2)
    const listed = [{ id: 'keyring-memory-bbbbbbbbbb', name: 'Someone else' }]
    const create = jest.fn(async (id: string) => {
      if (id === 'keyring-memory-bbbbbbbbbb') throw new Error('taskFailed')
    })
    const result = await createMemory({ listContexts: async () => listed, createContext: create }, 'Travel', random)
    expect(result).toEqual({ ok: true, memory: { id: 'keyring-memory-cccccccccc', name: 'Travel' } })

    const refused = await createMemory(
      {
        listContexts: async () => [],
        createContext: async () => {
          throw new Error('permissionDenied')
        },
      },
      'Travel',
      bytes(3)
    )
    expect(refused).toEqual({ ok: false, code: 'failed' })
  })

  it('a create an approval rule held is heldForApproval, tried once, never redrawn or re-listed', async () => {
    const held = Object.assign(new Error('held'), { details: { reason: 'auth:consent_required' } })
    const create = jest.fn(async () => {
      throw held
    })
    const list = jest.fn(async () => [])
    const result = await createMemory(
      { listContexts: list, createContext: create },
      'Travel',
      bytes(3),
      (e) => e === held
    )
    expect(result).toEqual({ ok: false, code: 'heldForApproval' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('an empty or over-long name fails without a call', async () => {
    const list = jest.fn(async () => [])
    expect(await createMemory({ listContexts: list, createContext: jest.fn() }, '   ', bytes(1))).toEqual({
      ok: false,
      code: 'failed',
    })
    expect(await createMemory({ listContexts: list, createContext: jest.fn() }, 'x'.repeat(65), bytes(1))).toEqual({
      ok: false,
      code: 'failed',
    })
    expect(list).not.toHaveBeenCalled()
  })
})

describe('countMemory (§3.15): vta/memory/list/0.3, includeValues false, every page', () => {
  it('counts live items across pages, never asks for values, and gives the latest updatedAt', async () => {
    const { port, sent } = memoryVta([
      [item('a', '2026-11-24T10:00:00Z'), item('b', '2026-11-25T10:00:00Z')],
      [item('c', '2026-11-26T09:00:00Z'), item('d', '2026-11-26T11:00:00Z', true)],
    ])
    expect(await countMemory(port, 'keyring-memory-educat1on')).toEqual({
      ok: true,
      count: 3,
      lastChange: '2026-11-26T09:00:00Z',
      complete: true,
    })
    expect(sent).toHaveLength(2)
    expect(sent.every((p) => p.includeValues === false)).toBe(true)
    expect(sent[1].cursor).toBe('c1')
  })

  it('stops at the page limit and says the count is incomplete', async () => {
    const pages = Array.from({ length: MEMORY_COUNT_MAX_PAGES + 2 }, (_, i) => [item(`k${i}`, '2026-11-26T09:00:00Z')])
    const result = await countMemory(memoryVta(pages).port, 'keyring-memory-educat1on')
    expect(result).toEqual({
      ok: true,
      count: MEMORY_COUNT_MAX_PAGES,
      lastChange: '2026-11-26T09:00:00Z',
      complete: false,
    })
  })

  it('a refusal or a malformed answer is a failed count, never a zero', async () => {
    const refused = memoryVta([[]], () => new Error('vta/memory/list:contextForbidden')).port
    expect(await countMemory(refused, 'x')).toEqual({ ok: false })
    const malformed: Pick<MemoryPort, 'task'> = { task: async () => ({ highWatermark: 1 }) }
    expect(await countMemory(malformed, 'x')).toEqual({ ok: false })
  })

  it('an empty memory counts zero with no last change', async () => {
    expect(await countMemory(memoryVta([[]]).port, 'x')).toEqual({ ok: true, count: 0, complete: true })
  })
})

describe('countNotice (§3.15)', () => {
  it('flags above the warning, and a rise since the last opening', () => {
    expect(countNotice(MEMORY_COUNT_WARNING, undefined)).toEqual({ overWarning: false })
    expect(countNotice(MEMORY_COUNT_WARNING + 1, MEMORY_COUNT_WARNING - 829)).toEqual({ overWarning: true, rose: 830 })
    expect(countNotice(5, 9)).toEqual({ overWarning: false })
  })
})

describe('the vendored vta/memory/list schemas still match the registry', () => {
  // Left to the formatter (not in packages/.prettierignore), so compared as JSON. Runs where the registry clone is
  // found (registryPath); CI has none and skips.
  const maybe = registryPath() ? it : it.skip

  maybe('the same JSON as the commit PROVENANCE names', () => {
    expectNoDrift(
      DIR,
      {
        'vta-memory-list-0.3.payload.schema.json': 'specs/vta/memory/list/0.3/payload.schema.json',
        'memory-record-0.1.schema.json': 'specs/vta/_shared/0.1/memory-record.schema.json',
        'acl-entry-0.3.schema.json': 'specs/acl/_shared/0.3/acl-entry.schema.json',
        'framework-0.2.schema.json': 'specs/_framework/0.2/framework.schema.json',
        'framework-0.4.schema.json': 'specs/_framework/0.4/framework.schema.json',
      },
      { as: 'json' }
    )
  })
})
