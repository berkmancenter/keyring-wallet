/**
 * Every version ladder this wallet asks, against models of the agents testers run, with the exact asks in order.
 *
 * A model is what vta-service actually does with a type URI, read at each tag in external/verifiable-trust-
 * infrastructure (`dispatch_table!` in trust_tasks/mod.rs, and trust_tasks/wire_v0_2.rs for the edge):
 * - a URI in the dispatch table is answered;
 * - a URI the `wire_v0_2` edge rewrites to an older one is answered too (v0.60.0 to v0.66.0: device/* at 0.2,
 *   vault/list and vault/upsert at 0.2 and 0.3, vault/sign-trust-task at 0.2);
 * - anything else is refused by `method_not_found` (helpers.rs): `unsupportedVersion` with `servedVersions` built
 *   from the dispatch table ALONE, so an edge-answered version is never named; `unsupportedType` when the family
 *   has nothing in the table.
 *
 * The bug this holds down (gate 10-28, My devices on a v0.65.0 agent: "Your agent refused this
 * (unsupportedVersion)"): device/list/0.3 was refused naming only device/list/0.1, and the step down, taking that
 * list as the whole truth, found nothing it speaks in it and gave up, though 0.2 is answered at the edge.
 */
import { VTA_TASK_VERSIONS } from '../module/VtaClient'
import { approveResponseTypesFor, STEP_UP_REQUEST_TYPES, STEP_UP_TASK } from '../module/stepUp'
import { forgetAllVersions, TaskVersions } from '../module/taskVersions'
import { AGENT_DEVICE_TASK, heartbeat, listAgentDevices } from '../module/vtaDevices'
import { VAULT_GET, VAULT_GET_02 } from '../module/vtiCardVault'
import { VtiRefusal } from '../module/vtiAgent'

const SPEC = 'https://trusttasks.org/spec/'
type Model = { table: string[]; edge: string[] }

/**
 * Per family: the versions in the dispatch table, and those answered only at the edge. Only the families a ladder
 * here asks.
 */
const at = (families: Record<string, [string[], string[]?]>): Model => ({
  table: Object.entries(families).flatMap(([f, [table]]) => table.map((v) => `${SPEC}${f}/${v}`)),
  edge: Object.entries(families).flatMap(([f, [, edge = []]]) => edge.map((v) => `${SPEC}${f}/${v}`)),
})

/** vta-service-v0.65.0 (fc157f76); v0.60.0 to v0.66.0 match it for these families except dids/create 1.2 (v0.65.0 on). */
const V0_65 = at({
  'acl/list': [['0.1']],
  'acl/grant': [['0.1']],
  'acl/revoke': [['0.1']],
  'acl/update': [['0.1']],
  'task-consent/decision': [['0.1']],
  'vault/sign-trust-task': [['0.1'], ['0.2']],
  'vault/list': [['0.1'], ['0.2', '0.3']],
  'vault/upsert': [['0.1'], ['0.2', '0.3']],
  'vault/credentials/get': [['0.1']],
  'vta/webvh/dids/create': [['1.0', '1.1', '1.2']],
  'policy/upsert': [['0.2']],
  'trust-task-discovery': [['0.1', '0.3']],
  'device/list': [['0.1'], ['0.2']],
  'device/heartbeat': [['0.1'], ['0.2']],
  'auth/step-up/approve-response': [['0.1', '0.2', '0.3']],
  'vta/contexts/delete': [['1.0']],
})

/** vta-service-v0.67.0 (93d36996): the old versions withdrawn, nothing at the edge below the current one. */
const V0_67 = at({
  'acl/list': [['0.3']],
  'acl/grant': [['0.2']],
  'acl/revoke': [['0.2']],
  'acl/update': [['0.2']],
  'task-consent/decision': [['0.2']],
  'vault/sign-trust-task': [['0.2']],
  'vault/list': [['0.4']],
  'vault/upsert': [['0.4']],
  'vault/credentials/get': [['0.2']],
  'vta/webvh/dids/create': [['1.2']],
  'policy/upsert': [['0.3']],
  'trust-task-discovery': [['0.3']],
  'device/list': [['0.3']],
  'device/heartbeat': [['0.3']],
  'auth/step-up/approve-response': [['0.6']],
  // Both, gated apart; only 1.1 from 61c23f20 (#2332).
  'vta/contexts/delete': [['1.0', '1.1']],
})

/**
 * vta-service-v0.68.0 (84ed3250 on): as v0.67.0 for these families, but a step-up is answered only in
 * approve-response/0.7 (IN-390 sweep, 2026-10-30). It mints approve-request/0.5.
 */
const V0_68: Model = {
  table: [
    ...V0_67.table.filter((u) => !u.includes('/auth/step-up/approve-response/')),
    `${SPEC}auth/step-up/approve-response/0.7`,
  ],
  edge: [],
}

/**
 * 0d3f268e (what first.openvtc.net ran on 10-28): as v0.67.0, but acl/* still only at 0.1, dids/create 1.0-1.2, and
 * contexts/delete only at 1.0.
 */
const V0D3F = {
  table: [
    ...V0_67.table.filter(
      (u) => !u.includes('/acl/') && !u.includes('/dids/create/') && !u.includes('/contexts/delete/')
    ),
    ...['list', 'grant', 'revoke', 'update'].map((f) => `${SPEC}acl/${f}/0.1`),
    ...['1.0', '1.1', '1.2'].map((v) => `${SPEC}vta/webvh/dids/create/${v}`),
    `${SPEC}vta/contexts/delete/1.0`,
  ],
  edge: V0_67.edge,
}

const familyOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/') + 1)

/** An agent as the model says; `asked` records every URI sent, in order. */
function agent(model: Model) {
  const asked: string[] = []
  const answer = async (uri: string): Promise<string> => {
    asked.push(uri)
    if (model.table.includes(uri) || model.edge.includes(uri)) return uri
    const served = model.table.filter((u) => familyOf(u) === familyOf(uri)).sort()
    if (served.length === 0) throw new VtiRefusal('unsupportedType', `unsupported type: ${uri}`)
    throw new VtiRefusal('unsupportedVersion', `unsupported version: ${uri} — this VTA serves ${served.join(', ')}`, {
      requestedType: uri,
      servedVersions: served,
    })
  }
  return { asked, answer }
}

const short = (uris: string[]) => uris.map((u) => u.slice(SPEC.length))

/** Every ladder this wallet asks: the client's table, and the ones written in place in their modules. */
const LADDERS: Record<string, readonly string[]> = {
  ...VTA_TASK_VERSIONS,
  deviceList: [AGENT_DEVICE_TASK.list03, AGENT_DEVICE_TASK.list],
  deviceHeartbeat: [AGENT_DEVICE_TASK.heartbeat03, AGENT_DEVICE_TASK.heartbeat],
  deviceAclList: [AGENT_DEVICE_TASK.aclList03, AGENT_DEVICE_TASK.aclList02, AGENT_DEVICE_TASK.aclList],
  deviceAclRevoke: [AGENT_DEVICE_TASK.aclRevoke02, AGENT_DEVICE_TASK.aclRevoke],
  vaultCredentialsGet: [VAULT_GET_02, VAULT_GET],
  ...Object.fromEntries(STEP_UP_REQUEST_TYPES.map((t) => [`stepUpResponse:${t}`, approveResponseTypesFor(t)])),
}

/** What each ladder asks of a v0.65.0 agent, in order. The last is the one answered. */
const ASKS_0_65: Record<string, string[]> = {
  aclList: ['acl/list/0.3', 'acl/list/0.2', 'acl/list/0.1'],
  aclGrant: ['acl/grant/0.2', 'acl/grant/0.1'],
  aclRevoke: ['acl/revoke/0.2', 'acl/revoke/0.1'],
  aclUpdate: ['acl/update/0.2', 'acl/update/0.1'],
  consentDecision: ['task-consent/decision/0.2', 'task-consent/decision/0.1'],
  vaultSignTrustTask: ['vault/sign-trust-task/0.2'],
  // 0.3 at the edge, as 275 sends today; before the fix the refusal's "0.1" took it straight to 0.1.
  vaultList: ['vault/list/0.4', 'vault/list/0.3'],
  vaultUpsert: ['vault/upsert/0.4', 'vault/upsert/0.3'],
  didsCreate: ['vta/webvh/dids/create/1.2'],
  policyUpsert: ['policy/upsert/0.3', 'policy/upsert/0.2'],
  discovery: ['trust-task-discovery/0.3'],
  // The gate's failure: before the fix, ['device/list/0.3'] and then the refusal.
  deviceList: ['device/list/0.3', 'device/list/0.2'],
  deviceHeartbeat: ['device/heartbeat/0.3', 'device/heartbeat/0.2'],
  deviceAclList: ['acl/list/0.3', 'acl/list/0.2', 'acl/list/0.1'],
  deviceAclRevoke: ['acl/revoke/0.2', 'acl/revoke/0.1'],
  vaultCredentialsGet: ['vault/credentials/get/0.2', 'vault/credentials/get/0.1'],
  contextsDelete: ['vta/contexts/delete/1.1', 'vta/contexts/delete/1.0'],
}

beforeEach(() => forgetAllVersions())

describe('every ladder against a v0.65.0 agent (v0.60.0 to v0.66.0)', () => {
  it('names every ladder this wallet asks', () => {
    // A new ladder must be added to ASKS_0_65 (and checked against the edge) before this passes.
    const stepUps = Object.keys(LADDERS).filter((k) => k.startsWith('stepUpResponse:'))
    expect(
      Object.keys(LADDERS)
        .filter((k) => !stepUps.includes(k))
        .sort()
    ).toEqual(Object.keys(ASKS_0_65).sort())
  })

  it.each(Object.entries(ASKS_0_65))('%s asks exactly %j', async (family, expected) => {
    const { asked, answer } = agent(V0_65)
    const { uri } = await new TaskVersions().ask(family, LADDERS[family], answer)
    expect(short(asked)).toEqual(expected)
    expect(uri.slice(SPEC.length)).toBe(expected[expected.length - 1])
  })

  it('answers each step-up in the request’s own version, after refusals of 0.7 and 0.6', async () => {
    for (const request of STEP_UP_REQUEST_TYPES) {
      const ladder = approveResponseTypesFor(request)
      const own = ladder[ladder.length - 1]
      const { asked, answer } = agent(V0_65)
      const served = V0_65.table.includes(own)
      const ask = new TaskVersions().ask('stepUpResponse', LADDERS[`stepUpResponse:${request}`], answer)
      if (served) {
        await expect(ask).resolves.toMatchObject({ uri: own })
        expect(short(asked)).toEqual([
          'auth/step-up/approve-response/0.7',
          'auth/step-up/approve-response/0.6',
          own.slice(SPEC.length),
        ])
      } else {
        // Request versions past 0.3 are 0d3f268e's and later: a v0.65.0 agent never mints them.
        await expect(ask).rejects.toBeInstanceOf(VtiRefusal)
      }
    }
  })

  it('pays each step down once: the second ask of a family goes straight to what answered', async () => {
    const { asked, answer } = agent(V0_65)
    const versions = new TaskVersions()
    await versions.ask('deviceList', LADDERS.deviceList, answer)
    await versions.ask('deviceList', LADDERS.deviceList, answer)
    expect(short(asked)).toEqual(['device/list/0.3', 'device/list/0.2', 'device/list/0.2'])
  })
})

describe('the same ladders against v0.68.0', () => {
  it.each(Object.keys(ASKS_0_65))('%s is answered at its first ask by v0.68.0', async (family) => {
    const { asked, answer } = agent(V0_68)
    await new TaskVersions().ask(family, LADDERS[family], answer)
    expect(asked).toEqual([LADDERS[family][0]])
  })

  it('a step-up to the approve-request it mints (0.5) is answered at the first ask, in approve-response 0.7', async () => {
    const family = `stepUpResponse:${STEP_UP_TASK.approveRequest05}`
    const { asked, answer } = agent(V0_68)
    await new TaskVersions().ask(family, LADDERS[family], answer)
    expect(short(asked)).toEqual(['auth/step-up/approve-response/0.7'])
  })
})

describe('the same ladders against v0.67.0 and 0d3f268e', () => {
  it.each(Object.keys(ASKS_0_65))('%s is answered at its first ask by v0.67.0', async (family) => {
    const { asked, answer } = agent(V0_67)
    await new TaskVersions().ask(family, LADDERS[family], answer)
    expect(asked).toEqual([LADDERS[family][0]])
  })

  it('0d3f268e: acl/* still steps down to 0.1 and contexts/delete to 1.0, everything else is answered first', async () => {
    for (const family of Object.keys(ASKS_0_65)) {
      const { asked, answer } = agent(V0D3F)
      await new TaskVersions().ask(family, LADDERS[family], answer)
      const acl = LADDERS[family][0].includes('/acl/')
      const contextsDelete = LADDERS[family][0].includes('/contexts/delete/')
      expect(asked[0]).toBe(LADDERS[family][0])
      if (acl) expect(asked[asked.length - 1]).toMatch(/\/acl\/[a-z]+\/0\.1$/)
      else if (contextsDelete) expect(short(asked)).toEqual(['vta/contexts/delete/1.1', 'vta/contexts/delete/1.0'])
      else expect(asked).toHaveLength(1)
    }
  })

  it('stops at the floor with the agent’s own refusal, asking each version once', async () => {
    // A v0.67.0 agent remembered at an older version than it serves is the upgrade case below; here, a family this
    // wallet speaks only below the agent's floor (a hypothetical device/list served only at 0.4).
    const beyond = at({ 'device/list': [['0.4']] })
    const { asked, answer } = agent(beyond)
    const refusal = new TaskVersions().ask('deviceList', LADDERS.deviceList, answer)
    await expect(refusal).rejects.toMatchObject({ code: 'unsupportedVersion' })
    expect(short(asked)).toEqual(['device/list/0.3', 'device/list/0.2'])
  })
})

describe('an agent upgraded since it was last asked', () => {
  it('goes up to the newer version its refusal names, from the older one remembered', async () => {
    const versions = new TaskVersions()
    const before = agent(V0_65)
    await versions.ask('deviceList', LADDERS.deviceList, before.answer)
    await versions.ask('vaultList', LADDERS.vaultList, before.answer)
    // Now v0.67.0: the remembered 0.2 and 0.3 are refused, naming 0.3 and 0.4.
    const after = agent(V0_67)
    await expect(versions.ask('deviceList', LADDERS.deviceList, after.answer)).resolves.toMatchObject({
      uri: AGENT_DEVICE_TASK.list03,
    })
    await expect(versions.ask('vaultList', LADDERS.vaultList, after.answer)).resolves.toMatchObject({
      uri: VTA_TASK_VERSIONS.vaultList[0],
    })
    expect(short(after.asked)).toEqual(['device/list/0.2', 'device/list/0.3', 'vault/list/0.3', 'vault/list/0.4'])
  })
})

describe('My devices and the heartbeat, through the module, on a v0.65.0 agent', () => {
  const port = (model: Model) => {
    const { asked, answer } = agent(model)
    return {
      asked,
      port: {
        managerDid: 'did:key:z6MkPhone',
        task: async <T>(type: string): Promise<T> => {
          const uri = await answer(type)
          if (uri.includes('/acl/list/')) return { entries: [{ subject: 'did:key:z6MkPhone', role: 'admin' }] } as T
          if (uri.includes('/device/list/')) return { devices: [] } as T
          return {} as T
        },
      },
    }
  }

  it('lists the devices (the gate showed "Your agent refused this (unsupportedVersion)")', async () => {
    const { asked, port: p } = port(V0_65)
    await expect(listAgentDevices(p)).resolves.toEqual(expect.any(Array))
    expect(short(asked).sort()).toEqual(
      ['acl/list/0.3', 'acl/list/0.2', 'acl/list/0.1', 'device/list/0.3', 'device/list/0.2'].sort()
    )
  })

  it('sends the heartbeat in 0.2 after one refusal of 0.3', async () => {
    const { asked, port: p } = port(V0_65)
    await heartbeat(p)
    expect(short(asked)).toEqual(['device/heartbeat/0.3', 'device/heartbeat/0.2'])
  })
})
