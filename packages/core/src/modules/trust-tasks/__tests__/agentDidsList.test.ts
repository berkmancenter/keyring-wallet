/**
 * The agent's list of identities, asked in the task the agent serves. VTI #2763 (a78a040e8, 2026-11-17) replaced
 * `vta/webvh/dids/list/1.0` with the method-neutral, paged `vta/dids/list/0.1` and left vta-service's version at
 * 0.83.0: the tagged 0.83.0 serves only the old task, a build of main after it only the new one. Bring back
 * (GetCardsFromAgent) is the one flow that lists, and on an agent serving only the new task it took on no identity.
 *
 * The same change moved `vta/contexts/delete` to 1.2, which only "Send me a test request" sends, to clean up.
 */
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return {
    ...actual,
    signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => doc),
    tsp: { ...actual.tsp, CODEC_FORMS_RELATIONSHIPS: true },
  }
})
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))

import {
  OFFERED_TASKS,
  PHONE_SENDS,
  TEST_REQUEST_TASKS,
  holdsThisPhone,
  ruleVersionsFor,
  versionsOf,
} from '../module/approvalRules'
import {
  DIDS_LIST_MAX_PAGES,
  DIDS_LIST_METHODS,
  VTA_TASK,
  VTA_TASK_VERSIONS,
  VtaClient,
  mintedDidOf,
} from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'

const NEUTRAL = 'https://trusttasks.org/spec/vta/dids/list/0.1'
const WEBVH = 'https://trusttasks.org/spec/vta/webvh/dids/list/1.0'
const DELETE = (version: string) => `https://trusttasks.org/spec/vta/contexts/delete/${version}`
const CREATE = 'https://trusttasks.org/spec/vta/contexts/create/1.0'

/** What an agent answers a task it does not serve at all (vta-service helpers.rs `method_not_found`). */
const notServed = (type: string, served: string[] = []) =>
  new VtiRefusal('unsupportedType', `unsupported type: ${type}`, { servedVersions: served })

const summary = (name: string, extra: Record<string, unknown> = {}) => ({
  did: `did:webvh:Qm${name}:dids.example:${name}`,
  method: 'webvh',
  level: 'identity',
  primary: false,
  deactivated: false,
  alsoKnownAs: [],
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
  contextId: 'personal',
  serverId: 'server-1',
  signingKeyId: `${name}#key-0`,
  keyAgreementKeyId: `${name}#key-1`,
  methodDetails: { webvh: { scid: `Qm${name}` } },
  ...extra,
})

type Asked = { type: string; payload: Record<string, unknown> }

/** A client whose agent answers each task as `agent` says; every ask is recorded. */
function client(agent: (asked: Asked) => unknown) {
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const vta = new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {})
  const asks: Asked[] = []
  const answer = async (...args: unknown[]) => {
    const asked = { type: args[0] as string, payload: args[1] as Record<string, unknown> }
    asks.push(asked)
    const result = agent(asked)
    if (result instanceof Error) throw result
    return result
  }
  jest.spyOn(vta as unknown as { task: (...a: unknown[]) => Promise<unknown> }, 'task').mockImplementation(answer)
  jest.spyOn(vta as unknown as { enqueue: (...a: unknown[]) => Promise<unknown> }, 'enqueue').mockImplementation(answer)
  return { vta, asks, logger, types: () => asks.map((a) => a.type) }
}

describe('what is asked', () => {
  it('the method-neutral list first, the did:webvh one behind it', () => {
    expect(VTA_TASK.vtaDidsList01).toBe(NEUTRAL)
    expect(VTA_TASK.didsList).toBe(WEBVH)
    expect(VTA_TASK_VERSIONS.didsList).toEqual([NEUTRAL, WEBVH])
  })

  it('for the two methods a did:webvh identity is listed under, and at most 20 pages', () => {
    expect([...DIDS_LIST_METHODS]).toEqual(['webvh', 'scid:vh'])
    expect(DIDS_LIST_MAX_PAGES).toBe(20)
  })
})

describe('an agent that serves the method-neutral list', () => {
  it('is asked it, once, and never the did:webvh one; each entry reads as the did:webvh list answered it', async () => {
    const h = client(({ type }) => (type === NEUTRAL ? { dids: [summary('al'), summary('bo')] } : notServed(type)))
    await expect(h.vta.listDids()).resolves.toEqual([
      {
        did: 'did:webvh:Qmal:dids.example:al',
        contextId: 'personal',
        serverId: 'server-1',
        scid: 'Qmal',
        signingKeyId: 'al#key-0',
        kaKeyId: 'al#key-1',
      },
      {
        did: 'did:webvh:Qmbo:dids.example:bo',
        contextId: 'personal',
        serverId: 'server-1',
        scid: 'Qmbo',
        signingKeyId: 'bo#key-0',
        kaKeyId: 'bo#key-1',
      },
    ])
    expect(h.asks).toEqual([{ type: NEUTRAL, payload: { methods: ['webvh', 'scid:vh'] } }])
  })

  it('is read page by page to the end, each page asked with the cursor the one before gave', async () => {
    const pages: Record<string, { dids: unknown[]; nextCursor?: string }> = {
      first: { dids: [summary('a'), summary('b')], nextCursor: 'c2' },
      c2: { dids: [summary('c')], nextCursor: 'c3' },
      c3: { dids: [summary('d')] },
    }
    const h = client(({ payload }) => pages[String(payload.cursor ?? 'first')])
    const listed = await h.vta.listDids('personal')
    expect(listed.map((d) => d.scid)).toEqual(['Qma', 'Qmb', 'Qmc', 'Qmd'])
    expect(h.asks.map((a) => a.payload)).toEqual([
      { methods: ['webvh', 'scid:vh'], contextId: 'personal' },
      { methods: ['webvh', 'scid:vh'], contextId: 'personal', cursor: 'c2' },
      { methods: ['webvh', 'scid:vh'], contextId: 'personal', cursor: 'c3' },
    ])
  })

  it('stops at 20 pages when the agent never ends its list, says so, and answers what it read', async () => {
    let page = 0
    const h = client(() => ({ dids: [summary(`p${++page}`)], nextCursor: `after-${page}` }))
    const listed = await h.vta.listDids()
    expect(listed).toHaveLength(DIDS_LIST_MAX_PAGES)
    expect(h.asks).toHaveLength(DIDS_LIST_MAX_PAGES)
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/list of identities was not read to its end \(more than 20 pages\): 20 read/)
    )
  })

  it('stops when the agent hands back a cursor it already gave, and says so', async () => {
    const h = client(({ payload }) =>
      payload.cursor === 'again'
        ? { dids: [summary('b')], nextCursor: 'again' }
        : { dids: [summary('a')], nextCursor: 'again' }
    )
    const listed = await h.vta.listDids()
    expect(listed.map((d) => d.scid)).toEqual(['Qma', 'Qmb'])
    expect(h.asks).toHaveLength(2)
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/not read to its end \(it repeated a page\): 2 read/)
    )
  })

  it('a refusal that is not about the version is the answer: the did:webvh list is not asked', async () => {
    const denied = new VtiRefusal('permissionDenied', 'permission denied')
    const h = client(() => denied)
    await expect(h.vta.listDids()).rejects.toBe(denied)
    expect(h.types()).toEqual([NEUTRAL])
  })
})

describe('an entry of the method-neutral list', () => {
  it('presented as its did:scid:vh:1 DID is named by its did:webvh one, as the did:webvh list named it', () => {
    const listed = mintedDidOf(
      summary('al', {
        did: 'did:scid:vh:1:Qmal',
        method: 'scid:vh',
        alsoKnownAs: ['did:webvh:Qmal:dids.example:al'],
        methodDetails: { 'scid:vh': { scid: 'Qmal' } },
      })
    )
    expect(listed).toMatchObject({ did: 'did:webvh:Qmal:dids.example:al', scid: 'Qmal', kaKeyId: 'al#key-1' })
  })

  it.each([
    ['of another method (the agent ignored the filter)', summary('k', { did: 'did:webs:host:Ek', method: 'webs' })],
    ['a did:scid one that names no did:webvh DID', summary('s', { did: 'did:scid:vh:1:Qms', method: 'scid:vh' })],
    [
      'of another method that also names a did:webvh DID of its own',
      summary('w', { did: 'did:webs:host:Ew', method: 'webs', alsoKnownAs: ['did:webvh:Qmw:dids.example:w'] }),
    ],
    ['with no DID', { ...summary('n'), did: undefined }],
    ['that is not an object', 'did:webvh:Qmx:dids.example:x'],
  ])('%s is left out', (_name, entry) => {
    expect(mintedDidOf(entry)).toBeUndefined()
  })

  it('missing the members only some entries carry still reads, with those empty', () => {
    expect(
      mintedDidOf({ did: 'did:webvh:Qmz:dids.example:z', method: 'webvh', alsoKnownAs: [], level: 'identity' })
    ).toEqual({ did: 'did:webvh:Qmz:dids.example:z', contextId: '', scid: '', signingKeyId: '', kaKeyId: '' })
  })
})

describe('an agent that serves only the did:webvh list', () => {
  const old = (dids: unknown) => (asked: Asked) => (asked.type === WEBVH ? dids : notServed(asked.type, [WEBVH]))

  it('refuses the method-neutral one, is asked the did:webvh one in its own payload, and its answer is as before', async () => {
    const records = [{ did: 'did:webvh:Qmal:dids.example:al', contextId: 'personal', scid: 'Qmal' }]
    const h = client(old({ dids: records }))
    await expect(h.vta.listDids()).resolves.toEqual(records)
    expect(h.asks).toEqual([
      { type: NEUTRAL, payload: { methods: ['webvh', 'scid:vh'] } },
      { type: WEBVH, payload: {} },
    ])
  })

  it('answering a bare array is read too, and a context is passed as before', async () => {
    const records = [{ did: 'did:webvh:Qmal:dids.example:al', contextId: 'personal', scid: 'Qmal' }]
    const h = client(old(records))
    await expect(h.vta.listDids('personal')).resolves.toEqual(records)
    expect(h.asks[1]).toEqual({ type: WEBVH, payload: { contextId: 'personal' } })
  })

  it('is asked the did:webvh one straight away the next time', async () => {
    const h = client(old({ dids: [] }))
    await h.vta.listDids()
    await h.vta.listDids()
    expect(h.types()).toEqual([NEUTRAL, WEBVH, WEBVH])
  })
})

describe('an agent updated while the app runs, from the did:webvh list to the method-neutral one', () => {
  it('is asked the remembered task, refused, then asked from the top in the same listing: nothing is lost', async () => {
    let updated = false
    const h = client(({ type }) => {
      if (!updated) return type === WEBVH ? { dids: [] } : notServed(type, [WEBVH])
      // No version of the did:webvh list is left, so the refusal names nothing to go to.
      return type === NEUTRAL ? { dids: [summary('al')] } : notServed(type)
    })
    await h.vta.listDids()
    updated = true
    const listed = await h.vta.listDids()
    expect(listed.map((d) => d.scid)).toEqual(['Qmal'])
    expect(h.types()).toEqual([NEUTRAL, WEBVH, WEBVH, NEUTRAL])
  })

  it('a refusal that is not about the version, from the remembered task, is not asked again', async () => {
    let denied = false
    const refusal = new VtiRefusal('permissionDenied', 'permission denied')
    const h = client(({ type }) => (denied ? refusal : type === WEBVH ? { dids: [] } : notServed(type, [WEBVH])))
    await h.vta.listDids()
    denied = true
    await expect(h.vta.listDids()).rejects.toBe(refusal)
    expect(h.types()).toEqual([NEUTRAL, WEBVH, WEBVH])
  })
})

describe('an agent that serves neither', () => {
  it('both are asked, and the refusal is thrown as a refused list always was', async () => {
    const h = client(({ type }) => notServed(type))
    await expect(h.vta.listDids()).rejects.toMatchObject({ code: 'unsupportedType' })
    expect(h.types()).toEqual([NEUTRAL, WEBVH])
    // Asked from the top, both were refused: not walked a second time.
    await expect(h.vta.listDids()).rejects.toMatchObject({ code: 'unsupportedType' })
    expect(h.types()).toEqual([NEUTRAL, WEBVH, NEUTRAL, WEBVH])
  })
})

describe("the test request's clean-up", () => {
  const serving =
    (version: string) =>
    ({ type }: Asked) =>
      type === CREATE || type === DELETE(version) ? {} : notServed(type, [DELETE(version)])

  it('asks contexts/delete at 1.2 first, with the payload every version takes', async () => {
    expect(VTA_TASK_VERSIONS.contextsDelete).toEqual([DELETE('1.2'), DELETE('1.1'), DELETE('1.0')])
    const h = client(serving('1.2'))
    await expect(h.vta.sendTestRequest()).resolves.toEqual({ kind: 'letThrough', cleanedUp: true })
    expect(h.types()).toEqual([CREATE, DELETE('1.2')])
    expect(h.asks[1].payload).toEqual({ id: h.asks[0].payload.id, force: true })
  })

  it.each([
    ['1.1', [DELETE('1.2'), DELETE('1.1')]],
    ['1.0', [DELETE('1.2'), DELETE('1.1'), DELETE('1.0')]],
  ])('steps down to %s on an agent that serves only that', async (version, asked) => {
    const h = client(serving(version))
    await expect(h.vta.sendTestRequest()).resolves.toEqual({ kind: 'letThrough', cleanedUp: true })
    expect(h.types()).toEqual([CREATE, ...asked])
  })
})

describe('the approval rules', () => {
  it('offer "before deleting a context" at 1.2, and still read a rule that names 1.1 or 1.0 as that one', () => {
    const offered = OFFERED_TASKS.find((o) => o.key === 'contextsDelete')?.taskType as string
    expect(offered).toBe(DELETE('1.2'))
    expect(versionsOf(offered)).toEqual([DELETE('1.2'), DELETE('1.1'), DELETE('1.0')])
  })

  it.each([['1.2'], ['1.1'], ['1.0']])('write the rule for the one version an agent dispatches (%s)', (version) => {
    expect(ruleVersionsFor(DELETE('1.2'), [DELETE(version), CREATE])).toEqual([DELETE(version)])
  })

  it('never hold this phone on either list, or on any version of the clean-up', () => {
    expect(holdsThisPhone(NEUTRAL)).toBe(true)
    expect(holdsThisPhone(WEBVH)).toBe(true)
    expect(PHONE_SENDS).toEqual(expect.arrayContaining([NEUTRAL, WEBVH]))
    expect([...TEST_REQUEST_TASKS]).toEqual([CREATE, DELETE('1.2'), DELETE('1.1'), DELETE('1.0')])
  })
})
