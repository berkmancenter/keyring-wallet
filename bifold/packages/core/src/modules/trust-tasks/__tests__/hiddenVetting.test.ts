/**
 * The applicant's round, driven against a fake agent and a fake VTA.
 *
 * What these tests are for is mostly *restraint*: the hard parts of hidden
 * vetting are the things the phone must not say (a count it cannot know), must
 * not do (probe before a tap), and must not swallow (an attestation the agent
 * refused). The payload shapes are graded elsewhere, by the registry's own
 * schemas in `pcsVtaPayloads.test.ts`.
 */
import {
  NOT_ENOUGH_YET,
  forgetHiddenApplication,
  hiddenProgress,
  hiddenSubmissionExtensions,
  hiddenVettingUsable,
  loadHiddenVettingRecord,
  refreshHiddenApplication,
  startHiddenApplication,
  takeHiddenAttestation,
} from '../module/hiddenVetting'
import { parseAclEntries } from '../module/VtaClient'
import { HIDDEN_VETTING_SUITE, type HiddenAttestation, type PublishedConfig } from '../module/pcsVtaPayloads'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Rec = {
  id: string
  content: Record<string, unknown>
  tags: Record<string, string>
  createdAt: Date
  updatedAt?: Date
}

function fakeAgent(seed: Rec[] = []) {
  const records: Rec[] = [...seed]
  let clock = 1_000
  let next = seed.length
  const warnings: string[] = []
  const agent = {
    config: { logger: { warn: (message: string) => warnings.push(message) } },
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) =>
        records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)),
      save: async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
        records.push({ id: `r${next++}`, content, tags, createdAt: new Date(clock++) })
      },
      update: async (record: Rec) => {
        const at = records.findIndex((r) => r.id === record.id)
        if (at >= 0) records[at] = { ...record, updatedAt: new Date(clock++) }
      },
      delete: async (record: Rec) => {
        const at = records.findIndex((r) => r.id === record.id)
        if (at >= 0) records.splice(at, 1)
      },
    },
  }
  return { agent: agent as never, records, warnings }
}

const COMMUNITY = 'did:webvh:QmCommunity:dids.example:hidden-vtc'
const JOIN_DID = 'did:peer:2.Ejoin'

const parameters: PublishedConfig = {
  suite: HIDDEN_VETTING_SUITE,
  helperKey: 'z6MkhelperKey',
  tokenKey: 'z6MktokenKey',
  vetterLabels: ['vetter/2026-10'],
  tokenLabels: ['token/2026-10'],
  dripPerTick: 3,
  tickLength: 'P3D',
  events: [],
}

/** A `trust-task-error` as the client surfaces one: the document hangs off the error. */
function refusal(code: string) {
  return Object.assign(new Error(code), { document: { payload: { code } } })
}

const attestations = (n: number) => Array.from({ length: n }, () => ({ meta: {} }))

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    managerDid: 'did:peer:2.Ephone',
    servesPcs: async () => true,
    // What a 0.60 agent answers about this session: capabilities already
    // resolved, and contexts as `ctx:<id>`.
    whoAmI: async () => ({ roles: ['initiator'], scopes: ['ctx:vta'], capabilities: ['pcs-applicant'] }),
    // The 0.1 shape, which is what vta-service 0.60 sends: `scopes` is the
    // CONTEXT list and the capability narrowing rides
    // ext["org.openvtc.capabilities"]. An earlier fake put the capability in
    // `scopes` — the same error the parser made — which is how a broken check
    // passed 25 tests. These shapes are graded against the registry's own
    // acl/_shared schemas in hiddenVettingAcl.test.ts, so the two cannot drift
    // into agreement again.
    listAcl: async () =>
      parseAclEntries([
        {
          subject: 'did:peer:2.Ephone',
          role: 'initiator',
          scopes: ['vta'],
          ext: { 'org.openvtc.capabilities': ['pcs-applicant'] },
        },
      ]),
    createPcsApplication: async () => ({ applicationId: 'app-1', id: 'pcs-id-1', attestations: [] }),
    showPcsApplication: async () => ({ applicationId: 'app-1', id: 'pcs-id-1', attestations: attestations(2) }),
    verifyPcsAttestation: async () => ({ applicationId: 'app-1', id: 'pcs-id-1', attestations: attestations(1) }),
    provePcs: async () => ({ proof: 'z2proof' }),
    deletePcsApplication: async () => undefined,
    ...over,
  } as never
}

/**
 * A client whose whoami carries no `capabilities`, so the question falls to the
 * access list. Without this, every test below would be answered by the whoami
 * route and would pass without exercising the ACL reading it is named for.
 */
const aclRouteClient = (over: Record<string, unknown> = {}) =>
  fakeClient({ whoAmI: async () => ({ roles: ['initiator'], scopes: ['ctx:vta'] }), ...over })

const start = (agent: never, client: never, minimum = 2) =>
  startHiddenApplication(agent, client, {
    contextId: 'ctx-1',
    community: COMMUNITY,
    joinDid: JOIN_DID,
    requirementsDigest: 'zQmRequirements',
    parameters,
    minimum,
  })

describe('whether the round can be run at all', () => {
  it('refuses a suite this build does not implement, without asking the agent', async () => {
    let asked = false
    const client = fakeClient({
      servesPcs: async () => {
        asked = true
        return true
      },
    })
    const answer = await hiddenVettingUsable(client, { ...parameters, suite: 'ps-other-suite' })
    expect(answer).toEqual({ usable: false, because: 'suiteUnsupported' })
    // The point of checking the suite first: it costs the agent nothing.
    expect(asked).toBe(false)
  })

  it('says the agent is too old before it says the phone is not allowed', async () => {
    // Precedence matters for what the person is told to do: `pcs-applicant`
    // cannot exist on a pre-0.60 agent, so "update your agent" is the step that
    // unblocks, and "this phone is not allowed" would send them nowhere.
    const client = fakeClient({ servesPcs: async () => false, listAcl: async () => parseAclEntries([]) })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'agentTooOld' })
  })

  it('reports that it could not tell, rather than guessing, when the probe is inconclusive', async () => {
    const client = fakeClient({ servesPcs: async () => undefined })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'cannotTell' })
  })

  it('reports that it could not tell when the access list cannot be read', async () => {
    const client = aclRouteClient({
      listAcl: async () => {
        throw new Error('unreachable')
      },
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'cannotTell' })
  })

  it('takes the answer from whoami, without reading the access list', async () => {
    // whoami needs no manage authority, so this is the route a
    // least-privileged phone actually has. If it answers, the ACL is not read.
    let readAcl = false
    const client = fakeClient({
      listAcl: async () => {
        readAcl = true
        return parseAclEntries([])
      },
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: true, parameters })
    expect(readAcl).toBe(false)
  })

  it('refuses when whoami does not name the capability', async () => {
    const client = fakeClient({
      whoAmI: async () => ({ roles: ['application'], scopes: ['ctx:vta'], capabilities: ['vault-read'] }),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'phoneNotAllowed' })
  })

  it('refuses a non-admin session with no contexts, which can reach nothing', async () => {
    const client = fakeClient({
      whoAmI: async () => ({ roles: ['initiator'], scopes: [], capabilities: ['pcs-applicant'] }),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'phoneNotAllowed' })
  })

  it('accepts an admin session with no contexts, which is unrestricted', async () => {
    const client = fakeClient({
      whoAmI: async () => ({ roles: ['admin'], scopes: [], capabilities: ['pcs-applicant'] }),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: true, parameters })
  })

  it('falls back to the access list when whoami carries no capabilities', async () => {
    // An older agent, or one that answers without the member: the question
    // falls to the ACL read, which needs manage authority and may be refused.
    const client = fakeClient({ whoAmI: async () => ({ roles: ['initiator'], scopes: ['ctx:vta'] }) })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: true, parameters })
  })

  it('refuses when no entry covers this phone', async () => {
    const client = aclRouteClient({
      listAcl: async () =>
        parseAclEntries([
          {
            subject: 'did:peer:2.Esomebodyelse',
            role: 'initiator',
            scopes: ['vta'],
            ext: { 'org.openvtc.capabilities': ['pcs-applicant'] },
          },
        ]),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'phoneNotAllowed' })
  })

  it('refuses a role that does not derive the capability, however it is narrowed', async () => {
    // At 0.60 only admin and initiator derive pcs-applicant, and the capability
    // is not additive — so an `application` entry naming it would have been
    // refused at the ACL surface, and an entry claiming it cannot be trusted
    // into usability here either.
    const client = aclRouteClient({
      listAcl: async () =>
        parseAclEntries([
          {
            subject: 'did:peer:2.Ephone',
            role: 'application',
            scopes: ['vta'],
            ext: { 'org.openvtc.capabilities': ['pcs-applicant'] },
          },
        ]),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'phoneNotAllowed' })
  })

  it('refuses a narrowing that does not name the capability', async () => {
    const client = aclRouteClient({
      listAcl: async () =>
        parseAclEntries([
          {
            subject: 'did:peer:2.Ephone',
            role: 'initiator',
            scopes: ['vta'],
            ext: { 'org.openvtc.capabilities': ['vault-read'] },
          },
        ]),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'phoneNotAllowed' })
  })

  it('accepts an un-narrowed entry whose role derives the capability', async () => {
    // No `capabilities` means the entry holds everything its role implies —
    // which is not the same as an empty array, and upstream omits the member
    // rather than sending one.
    const client = aclRouteClient({
      listAcl: async () => parseAclEntries([{ subject: 'did:peer:2.Ephone', role: 'initiator', scopes: ['vta'] }]),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: true, parameters })
  })

  it('refuses a non-admin entry with no contexts, which can reach nothing', async () => {
    // The dangerous case, and the one the first version got backwards: an empty
    // context list is unrestricted only for an admin. For any other role it is
    // no access at all, so reporting it usable would send the person into a
    // flow that cannot start.
    const client = aclRouteClient({
      listAcl: async () => parseAclEntries([{ subject: 'did:peer:2.Ephone', role: 'initiator', scopes: [] }]),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: false, because: 'phoneNotAllowed' })
  })

  it('accepts an admin entry with no contexts, which is unrestricted', async () => {
    const client = aclRouteClient({
      listAcl: async () => parseAclEntries([{ subject: 'did:peer:2.Ephone', role: 'admin', scopes: [] }]),
    })
    expect(await hiddenVettingUsable(client, parameters)).toEqual({ usable: true, parameters })
  })

  it('completes what the community left out, and hands back what was sent', async () => {
    const { tickLength: _t, ...sparse } = parameters
    const answer = await hiddenVettingUsable(fakeClient(), sparse)
    expect(answer).toEqual({ usable: true, parameters: { ...parameters, tickLength: 'P3D' } })
  })
})

describe('the record this phone keeps', () => {
  it('keeps what is needed to find the application again, and no secret', async () => {
    const { agent } = fakeAgent()
    const before = Date.now()
    const record = await start(agent, fakeClient())
    // Still an exact match, so a member added without thought fails here: the
    // record is what a screen reads and what survives a restart.
    expect(record).toEqual({
      community: COMMUNITY,
      joinDid: JOIN_DID,
      applicationId: 'app-1',
      id: 'pcs-id-1',
      requirementsDigest: 'zQmRequirements',
      parameters,
      createdAt: record.createdAt,
      held: 0,
      minimum: 2,
    })
    // And the time is the application's own, not a placeholder: the screens
    // show how long this has been gathering.
    expect(Date.parse(record.createdAt ?? '')).toBeGreaterThanOrEqual(before)
    expect(await loadHiddenVettingRecord(agent, COMMUNITY)).toEqual(record)
    // Nothing in the stored record is an attestation, a key or a proof.
    const stored = JSON.stringify(await loadHiddenVettingRecord(agent, COMMUNITY))
    for (const forbidden of ['attestation', 'proof', 'secret', 'privateKey']) {
      expect(stored.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('re-reads the agent rather than trusting its own count', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    const refreshed = await refreshHiddenApplication(agent, fakeClient(), COMMUNITY)
    expect(refreshed).toMatchObject({ held: 2 })
    expect(await loadHiddenVettingRecord(agent, COMMUNITY)).toMatchObject({ held: 2 })
  })

  it('says an application is gone rather than silently starting another', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    const client = fakeClient({
      showPcsApplication: async () => {
        throw refusal('vta/pcs/applications/show:notFound')
      },
    })
    expect(await refreshHiddenApplication(agent, client, COMMUNITY)).toBe('gone')
  })

  it('is undefined when this phone holds nothing for the community', async () => {
    const { agent } = fakeAgent()
    expect(await refreshHiddenApplication(agent, fakeClient(), COMMUNITY)).toBeUndefined()
  })

  it('counts what the agent reports after an attestation is verified', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    const attestation: HiddenAttestation = {
      suite: HIDDEN_VETTING_SUITE,
      attestation: 'z2attestationBytes',
      meta: {},
      token: { label: 'token/2026-10', serial: 'z2TokenSer', shown: 'z2Shown' },
    }
    expect(await takeHiddenAttestation(agent, fakeClient(), COMMUNITY, attestation)).toMatchObject({ held: 1 })
  })

  it('lets a refused attestation reach the caller, rather than swallowing it', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    const client = fakeClient({
      verifyPcsAttestation: async () => {
        throw refusal('vta/pcs/verify-attestation:attestationInvalid')
      },
    })
    await expect(
      takeHiddenAttestation(agent, client, COMMUNITY, {
        suite: HIDDEN_VETTING_SUITE,
        attestation: 'z2bad',
        meta: {},
        token: { label: 'token/2026-10', serial: 'z2TokenSer', shown: 'z2Shown' },
      })
    ).rejects.toThrow('attestationInvalid')
  })
})

describe('what a screen may say about progress', () => {
  it('leaves what only the community knows absent, not zero', () => {
    const progress = hiddenProgress({ held: 3, minimum: 2 })
    expect(progress).toEqual({ mode: 'hidden', held: 3, minimum: 2, worthSubmitting: true })
    // A zero renders as "none counted", which this phone cannot claim: the
    // engine accepts a duplicate attestation and the community counts it once.
    expect('counted' in progress).toBe(false)
    expect('stillNeeds' in progress).toBe(false)
  })

  it('is optimistic only, and only once the minimum is held', () => {
    expect(hiddenProgress({ held: 1, minimum: 2 }).worthSubmitting).toBe(false)
    expect(hiddenProgress({ held: 2, minimum: 2 }).worthSubmitting).toBe(true)
  })

  it('takes counted and stillNeeds from the community alone', () => {
    expect(hiddenProgress({ held: 3, minimum: 2 }, { counted: 2, stillNeeds: 0 })).toMatchObject({
      counted: 2,
      stillNeeds: 0,
    })
  })
})

describe('proving, at submission', () => {
  const hiddenSubmission = (agent: never, over: Record<string, unknown> = {}) =>
    hiddenSubmissionExtensions(agent, fakeClient(over), COMMUNITY, 'challenge-from-the-community')

  it('returns the extensions object the join submission carries', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    expect(await hiddenSubmission(agent)).toEqual({ hiddenVetting: { proof: 'z2proof' } })
  })

  it('reads too few attestations as progress, not as a failure', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    const answer = await hiddenSubmission(agent, {
      provePcs: async () => {
        throw refusal('vta/pcs/prove:noUsableAttestation')
      },
    })
    expect(answer).toBe(NOT_ENOUGH_YET)
  })

  it('does not disguise a real refusal as progress', async () => {
    const { agent } = fakeAgent()
    await start(agent, fakeClient())
    await expect(
      hiddenSubmission(agent, {
        provePcs: async () => {
          throw refusal('parametersInvalid')
        },
      })
    ).rejects.toThrow('parametersInvalid')
  })

  // 2026-10-15: his submit at 0 of 1 asked the agent to prove and sat waiting
  // on a ninety-second call. `prove` is the one expensive ask in the flow.
  it('asks nobody to prove below the threshold, and spends no call on it', async () => {
    const { agent } = fakeAgent()
    let proved = false
    const short = {
      showPcsApplication: async () => ({ applicationId: 'app-1', id: 'pcs-id-1', attestations: attestations(0) }),
      provePcs: async () => {
        proved = true
        return { proof: 'z2proof' }
      },
    }
    await start(agent, fakeClient(short) as never)
    expect(await hiddenSubmission(agent, short)).toBe(NOT_ENOUGH_YET)
    expect(proved).toBe(false)
  })

  // The local count lags the agent's: the record is written when the
  // application is created, with no attestations, and attestations arrive
  // afterwards. Believing a short record on its own would refuse a submit that
  // the agent would have proved.
  it('refreshes a record that looks short before believing it', async () => {
    const { agent } = fakeAgent()
    let asked = 0
    const client = fakeClient({
      showPcsApplication: async () => {
        asked += 1
        return { applicationId: 'app-1', id: 'pcs-id-1', attestations: attestations(2) }
      },
    })
    await start(agent, client)
    // The record is at 0 of 2 after `start`; only the agent knows there are two.
    expect(
      await hiddenSubmission(agent, {
        showPcsApplication: (client as never as { showPcsApplication: unknown }).showPcsApplication,
      })
    ).toEqual({
      hiddenVetting: { proof: 'z2proof' },
    })
    expect(asked).toBeGreaterThan(0)
  })

  it('refuses to prove without an application, rather than inventing one', async () => {
    const { agent } = fakeAgent()
    await expect(hiddenSubmission(agent)).rejects.toThrow(/no hidden-vetting application/)
  })
})

describe('forgetting an application', () => {
  it('tells the agent and drops the record', async () => {
    const { agent, records } = fakeAgent()
    await start(agent, fakeClient())
    let deleted: string | undefined
    await forgetHiddenApplication(
      agent,
      fakeClient({
        deletePcsApplication: async (id: string) => {
          deleted = id
        },
      }),
      COMMUNITY
    )
    expect(deleted).toBe('app-1')
    expect(records).toHaveLength(0)
  })

  it('drops the record even when the agent cannot be told', async () => {
    // Otherwise a decided join offers a "resume" that cannot work, because a
    // network error happened once.
    const { agent, records, warnings } = fakeAgent()
    await start(agent, fakeClient())
    await forgetHiddenApplication(
      agent,
      fakeClient({
        deletePcsApplication: async () => {
          throw new Error('unreachable')
        },
      }),
      COMMUNITY
    )
    expect(records).toHaveLength(0)
    expect(warnings.join(' ')).toContain('app-1')
  })
})

// The seam's own tests live in hiddenVettingAdapter.test.ts: the contract is
// screens/hiddenVettingSeam.ts's, and this module no longer declares one.
