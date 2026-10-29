/**
 * acl/* and task-consent/decision, newest first (group 1b): vta-service v0.52.0 to 0d3f268e serve acl/* only at 0.1,
 * v0.67.0 only acl/{grant,revoke,update}/0.2 and acl/list/0.3; v0.60.0 to v0.66.0 serve decision/0.1 only, 0d3f268e
 * on only 0.2. The newest is asked first, an agent that does not serve it answers `unsupportedVersion` naming the
 * full URIs in its dispatch table (trust_tasks/helpers.rs `method_not_found`), the client steps to the next older
 * version (or up to a newer one named), and remembers what answered.
 */
import { FULL_ADMIN_AUTHORITY_02, VTA_TASK, VtaClient } from '../module/VtaClient'
import { TaskVersions, isUnsupportedVersionRefusal, versionAfterRefusal } from '../module/taskVersions'
import { VtiRefusal } from '../module/vtiAgent'

const VTA = 'did:webvh:agent'
const PHONE = 'did:key:z6MkPhoneManager'
const NEW_PHONE = 'did:key:z6MkNewPhone'
const DIGEST = 'zQmQn96RqUtEvrotxBniT2zymX4W7kXBmnWiiAmbJemqpoi'

/** What a v0.52.0 agent answers a version it does not serve. */
const unsupported = (type: string, served: string[]) =>
  new VtiRefusal('unsupportedVersion', `unsupported version: ${type} — this VTA serves ${served.join(', ')}`, {
    requestedType: type,
    servedVersions: served,
  })

/** An agent that serves only the given URIs; `answer` gives the payload of a served one. */
function agentServing(served: string[], answer: (type: string, payload: Record<string, unknown>) => unknown) {
  const vta = new VtaClient({ config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never, VTA, {} as never, {})
  jest.spyOn(vta, 'managerDid', 'get').mockReturnValue(PHONE)
  const send = jest
    .spyOn(vta as unknown as { sendTask: (...a: unknown[]) => Promise<unknown> }, 'sendTask')
    .mockImplementation(async (type: unknown, payload: unknown) => {
      const t = String(type)
      if (!served.includes(t)) {
        const family = t.replace(/\/[0-9.]+$/, '/')
        throw unsupported(
          t,
          served.filter((s) => s.startsWith(family))
        )
      }
      return answer(t, payload as Record<string, unknown>)
    })
  return {
    vta,
    sent: () => send.mock.calls.map((c) => ({ type: String(c[0]), payload: c[1] as Record<string, unknown> })),
  }
}

const V01 = [VTA_TASK.aclList, VTA_TASK.aclGrant, VTA_TASK.aclRevoke, VTA_TASK.aclUpdate, VTA_TASK.consentDecision]
const V02 = [
  VTA_TASK.aclList03,
  VTA_TASK.aclList02,
  VTA_TASK.aclGrant02,
  VTA_TASK.aclRevoke02,
  VTA_TASK.aclUpdate02,
  VTA_TASK.consentDecision02,
]

describe('the version step-down', () => {
  it('is taken only on unsupportedVersion or unsupportedType', () => {
    expect(isUnsupportedVersionRefusal(unsupported('x/0.2', ['x/0.1']))).toBe(true)
    expect(isUnsupportedVersionRefusal(new VtiRefusal('unsupportedType', 'no'))).toBe(true)
    expect(isUnsupportedVersionRefusal(new VtiRefusal('permissionDenied', 'no'))).toBe(false)
    expect(isUnsupportedVersionRefusal(new Error('unsupportedVersion'))).toBe(false)
  })

  it('steps to the next older version whether or not the refusal names it, and up only to a newer one it names', () => {
    const uris = ['f/0.3', 'f/0.2', 'f/0.1']
    // vta-service v0.60.0 to v0.66.0 name only their dispatch table, so 0.2 (answered at the edge) is not named:
    // it is asked anyway. Jumping straight to the named 0.1 is what gave up on device/list (no 0.1 in its list)
    // and took vault/list to 0.1 past the 0.3 those agents answer.
    expect(versionAfterRefusal(uris, 'f/0.3', unsupported('f/0.3', ['f/0.1']))).toBe('f/0.2')
    expect(versionAfterRefusal(['f/0.3', 'f/0.2'], 'f/0.3', unsupported('f/0.3', ['f/0.1']))).toBe('f/0.2')
    expect(versionAfterRefusal(uris, 'f/0.3', new VtiRefusal('unsupportedVersion', 'no'))).toBe('f/0.2')
    // A newer one named is an upgraded agent: up to it, past the older ones.
    expect(versionAfterRefusal(uris, 'f/0.1', unsupported('f/0.1', ['f/0.3']))).toBe('f/0.3')
    // Undefined because 0.1 is the last rung, not because the agent named only 0.0: nothing older is left.
    expect(versionAfterRefusal(uris, 'f/0.1', unsupported('f/0.1', ['f/0.0']))).toBeUndefined()
  })

  it('follows an agent that upgraded since it was asked: the remembered version refused, a newer one named', async () => {
    const versions = new TaskVersions()
    let upgraded = false
    const send = async (uri: string) => {
      if (!upgraded) {
        if (uri === 'f/0.2') throw unsupported(uri, ['f/0.1'])
        return uri
      }
      if (uri === 'f/0.1') throw unsupported(uri, ['f/0.2'])
      return uri
    }
    await expect(versions.ask('f', ['f/0.2', 'f/0.1'], send)).resolves.toEqual({ uri: 'f/0.1', answer: 'f/0.1' })
    upgraded = true
    await expect(versions.ask('f', ['f/0.2', 'f/0.1'], send)).resolves.toEqual({ uri: 'f/0.2', answer: 'f/0.2' })
  })

  it('gives up with the agent’s own refusal when nothing it serves is spoken here', async () => {
    const refusal = unsupported('f/0.2', ['f/0.9'])
    const versions = new TaskVersions()
    await expect(
      versions.ask('f', ['f/0.2', 'f/0.1'], async () => {
        throw refusal
      })
    ).rejects.toBe(refusal)
  })
})

// vta-service 0.53.1 and 0.54.0 serve acl/* only at 0.1 (trust_tasks/mod.rs:2245-2255),
// and a refused 0.2 never reached the phone over TSP (al-phone, 10-05: Add another
// device "didn't answer"). 0.1 goes first: one message, answered.
describe('reporting the version in use', () => {
  const A = 'https://t/x/0.2'
  const B = 'https://t/x/0.1'

  it('reports a family once when its version is learned, and again only when it changes', async () => {
    const served = jest.fn()
    const versions = new TaskVersions(undefined, served)
    await versions.ask('x', [A, B], async () => 'ok')
    await versions.ask('x', [A, B], async () => 'ok')
    expect(served.mock.calls).toEqual([['x', A]])
    // The agent now serves only B: one step down, one new report.
    let first = true
    await versions.ask('x', [A, B], async (uri) => {
      if (first && uri === A) {
        first = false
        throw new VtiRefusal('unsupportedVersion', 'no', { servedVersions: [B] })
      }
      return 'ok'
    })
    expect(served.mock.calls).toEqual([
      ['x', A],
      ['x', B],
    ])
  })

  it('a report that throws never fails the answer or stops the step down', async () => {
    const boom = () => {
      throw new Error('no logger')
    }
    const versions = new TaskVersions(boom, boom)
    let first = true
    const { uri, answer } = await versions.ask('x', [A, B], async (u) => {
      if (first) {
        first = false
        throw new VtiRefusal('unsupportedVersion', 'no')
      }
      return `answered at ${u}`
    })
    expect({ uri, answer }).toEqual({ uri: B, answer: `answered at ${B}` })
  })
})

describe('the access list, against an agent that serves only 0.1 (v0.52.0 to 0d3f268e)', () => {
  it('asks list in 0.3, then 0.2, then 0.1, and asks 0.1 straight away the next time', async () => {
    const { vta, sent } = agentServing(V01, () => ({ entries: [{ subject: PHONE, role: 'admin' }], truncated: false }))
    await expect(vta.listAcl()).resolves.toEqual([{ subject: PHONE, role: 'admin' }])
    await vta.listAcl()
    expect(sent().map((s) => s.type)).toEqual([
      VTA_TASK.aclList03,
      VTA_TASK.aclList02,
      VTA_TASK.aclList,
      VTA_TASK.aclList,
    ])
  })

  it('grants in 0.1 with the 0.1 entry, after 0.2 is refused as unsupported', async () => {
    const { vta, sent } = agentServing(V01, (_t, p) => ({ entry: p.entry }))
    await expect(vta.grantAdmin(NEW_PHONE, { label: 'Keyring' })).resolves.toMatchObject({
      subject: NEW_PHONE,
      role: 'admin',
    })
    expect(sent()[0].type).toBe(VTA_TASK.aclGrant02)
    expect(sent().slice(1)).toEqual([
      { type: VTA_TASK.aclGrant, payload: { entry: { subject: NEW_PHONE, role: 'admin', label: 'Keyring' } } },
    ])
  })

  it('revokes and relabels in 0.1 with their 0.1 payloads', async () => {
    const { vta, sent } = agentServing(V01, (_t, p) => ({ entry: { subject: p.subject, role: 'admin' } }))
    await vta.revokeSubject(NEW_PHONE)
    await vta.labelAclEntry(NEW_PHONE, '  Keyring — iPad  ')
    expect(sent().filter((s) => !s.type.endsWith('/0.2'))).toEqual([
      { type: VTA_TASK.aclRevoke, payload: { subject: NEW_PHONE } },
      { type: VTA_TASK.aclUpdate, payload: { subject: NEW_PHONE, label: 'Keyring — iPad' } },
    ])
  })
})

describe('the access list, against an agent that serves 0.2 (v0.67.0)', () => {
  it('grants a full administrator with the authority 0.2 requires, in one message', async () => {
    const { vta, sent } = agentServing(V02, (_t, p) => ({ entry: p.entry }))
    await vta.grantAdmin(NEW_PHONE, { label: 'Keyring' })
    expect(sent()).toEqual([
      {
        type: VTA_TASK.aclGrant02,
        payload: {
          entry: {
            subject: NEW_PHONE,
            role: 'admin',
            label: 'Keyring',
            act: { scope: 'all' },
            keys: { scope: 'all' },
            capabilities: { scope: 'ceiling' },
          },
        },
      },
    ])
    expect(FULL_ADMIN_AUTHORITY_02).toEqual({
      act: { scope: 'all' },
      keys: { scope: 'all' },
      capabilities: { scope: 'ceiling' },
    })
  })

  it('revokes with an explicit full removal and accepts the null entry 0.2 answers', async () => {
    const { vta, sent } = agentServing(V02, () => ({ entry: null }))
    await expect(vta.revokeSubject(NEW_PHONE)).resolves.toBeUndefined()
    expect(sent()).toEqual([
      { type: VTA_TASK.aclRevoke02, payload: { subject: NEW_PHONE, revocation: { kind: 'entry' } } },
    ])
  })

  it('reads 0.2 entries, whose authority is act/keys/capabilities rather than scopes', async () => {
    const entry = {
      subject: PHONE,
      role: 'admin',
      act: { scope: 'all' },
      keys: { scope: 'all' },
      capabilities: { scope: 'ceiling' },
      label: 'Keyring',
      createdAt: '2026-10-03T08:00:00Z',
    }
    const { vta } = agentServing(V02, () => ({ entries: [entry], truncated: false }))
    // The authority is now **kept**, where this used to assert it was dropped.
    // Hidden vetting has to decide whether a phone may apply, and that is a
    // question about exactly these members: `act` says what the entry may act
    // on and `capabilities` whether it is narrowed. Dropping them left the only
    // available signal `scopes`, which 0.2 does not send at all — so a
    // consumer had to guess, and guessing is what produced a check that was
    // wrong in both directions.
    await expect(vta.listAcl()).resolves.toEqual([
      {
        subject: PHONE,
        role: 'admin',
        label: 'Keyring',
        createdAt: '2026-10-03T08:00:00Z',
        act: { stated: 'all' },
        capabilityScope: { stated: 'ceiling' },
      },
    ])
  })

  it('reads no `scopes` from a 0.2 entry, because 0.2 does not send one', async () => {
    // The member whose absence used to be indistinguishable from "no access".
    const entry = {
      subject: PHONE,
      role: 'initiator',
      act: { scope: 'contexts', contexts: ['vta'] },
      keys: { scope: 'none' },
      capabilities: { scope: 'listed', grants: [{ capability: 'pcs-applicant' }] },
    }
    const { vta } = agentServing(V02, () => ({ entries: [entry], truncated: false }))
    const [parsed] = await vta.listAcl()
    expect(parsed.scopes).toBeUndefined()
    expect(parsed.act).toEqual({ stated: 'contexts', contexts: ['vta'] })
    expect(parsed.capabilityScope).toEqual({ stated: 'listed', capabilities: ['pcs-applicant'] })
  })
})

describe('a consent decision', () => {
  // 0.2 first now (group 1b): 0d3f268e serves only decision/0.2, v0.60.0 to v0.66.0 only 0.1, so one of them steps
  // down whichever goes first. The step-down needs the refusal to reach the phone; over TSP it once did not
  // (al-phone, 10-05), which is why 0.1 went first until the agents stopped sharing a version.
  it('is sent as decision/0.2 first, in one message, to an agent that serves 0.2', async () => {
    const { vta, sent } = agentServing(V02, () => ({ status: 'granted' }))
    await expect(vta.decideConsent({ challenge: 'c'.repeat(32), payloadDigest: DIGEST }, 'approve')).resolves.toEqual({
      status: 'granted',
    })
    expect(sent()).toEqual([
      {
        type: VTA_TASK.consentDecision02,
        payload: { challenge: 'c'.repeat(32), payloadDigest: DIGEST, decision: 'approve' },
      },
    ])
  })

  it('an agent that refuses 0.2 as unsupported is asked in 0.1, with the same members', async () => {
    const { vta, sent } = agentServing(V01, () => ({ status: 'granted' }))
    await expect(vta.decideConsent({ challenge: 'c'.repeat(32), payloadDigest: DIGEST }, 'approve')).resolves.toEqual({
      status: 'granted',
    })
    const [first, second] = sent()
    expect(first.type).toBe(VTA_TASK.consentDecision02)
    expect(second.type).toBe(VTA_TASK.consentDecision)
    expect(second.payload).toEqual(first.payload)
  })

  it('is not re-sent in another version when the agent refuses the decision itself', async () => {
    const { vta, sent } = agentServing(V01, () => {
      throw new VtiRefusal('task-consent/decision:challengeExpired', 'expired')
    })
    await expect(
      vta.decideConsent({ challenge: 'c'.repeat(32), payloadDigest: DIGEST }, 'deny', 'not me')
    ).rejects.toThrow('expired')
    // 0.2 refused as unsupported by this 0.1 agent, then 0.1, which the agent refuses for itself: not re-sent.
    expect(sent().map((s) => s.type)).toEqual([VTA_TASK.consentDecision02, VTA_TASK.consentDecision])
  })
})
