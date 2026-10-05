/**
 * Speaking acl/* 0.2 and task-consent/decision 0.2 ahead of the agent
 * (trust-tasks-tf ce07a039, released in #715): ask the new version, step down
 * to 0.1 when the agent answers `unsupportedVersion`, and remember what it
 * serves. vta-service v0.52.0 serves only the 0.1 versions
 * (trust_tasks/mod.rs:2242-2256) and answers any other version of a family it
 * serves with `unsupportedVersion` naming the full URIs it does serve
 * (trust_tasks/helpers.rs `method_not_found`).
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

  it('goes to a version the agent names, skipping ones it does not serve', () => {
    const uris = ['f/0.3', 'f/0.2', 'f/0.1']
    expect(versionAfterRefusal(uris, 'f/0.3', unsupported('f/0.3', ['f/0.1']))).toBe('f/0.1')
    expect(versionAfterRefusal(uris, 'f/0.3', new VtiRefusal('unsupportedVersion', 'no'))).toBe('f/0.2')
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

describe('the access list, against an agent that serves only 0.1 (v0.52.0)', () => {
  it('asks list in 0.2, steps down to 0.1 once, and asks 0.1 straight away after that', async () => {
    const { vta, sent } = agentServing(V01, () => ({ entries: [{ subject: PHONE, role: 'admin' }], truncated: false }))
    await expect(vta.listAcl()).resolves.toEqual([{ subject: PHONE, role: 'admin' }])
    await vta.listAcl()
    expect(sent().map((s) => s.type)).toEqual([VTA_TASK.aclList02, VTA_TASK.aclList, VTA_TASK.aclList])
  })

  it('grants in 0.1 with the 0.1 entry, after 0.2 is refused', async () => {
    const { vta, sent } = agentServing(V01, (_t, p) => ({ entry: p.entry }))
    await expect(vta.grantAdmin(NEW_PHONE, { label: 'Keyring' })).resolves.toMatchObject({
      subject: NEW_PHONE,
      role: 'admin',
    })
    const [first, second] = sent()
    expect(first.type).toBe(VTA_TASK.aclGrant02)
    expect(second).toEqual({
      type: VTA_TASK.aclGrant,
      payload: { entry: { subject: NEW_PHONE, role: 'admin', label: 'Keyring' } },
    })
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

describe('the access list, against an agent that serves 0.2', () => {
  it('grants a full administrator with the authority 0.2 requires', async () => {
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
    await expect(vta.listAcl()).resolves.toEqual([
      { subject: PHONE, role: 'admin', label: 'Keyring', createdAt: '2026-10-03T08:00:00Z' },
    ])
  })
})

describe('a consent decision', () => {
  // al-phone, 10-05: vta-service 0.53.1 serves only decision/0.1, and its
  // refusal of a 0.2 decision never reached the phone over TSP, so Approve
  // hung. 0.1 goes first: one message, answered, on every agent in use.
  it('is sent as decision/0.1 first, in one message, to an agent that serves only 0.1', async () => {
    const { vta, sent } = agentServing(V01, () => ({ status: 'granted' }))
    await expect(vta.decideConsent({ challenge: 'c'.repeat(32), payloadDigest: DIGEST }, 'approve')).resolves.toEqual({
      status: 'granted',
    })
    expect(sent()).toEqual([
      {
        type: VTA_TASK.consentDecision,
        payload: { challenge: 'c'.repeat(32), payloadDigest: DIGEST, decision: 'approve' },
      },
    ])
  })

  it('an agent that refuses 0.1 as unsupported is asked in 0.2, with the same members', async () => {
    const { vta, sent } = agentServing(V02, () => ({ status: 'granted' }))
    await expect(vta.decideConsent({ challenge: 'c'.repeat(32), payloadDigest: DIGEST }, 'approve')).resolves.toEqual({
      status: 'granted',
    })
    const [first, second] = sent()
    expect(first.type).toBe(VTA_TASK.consentDecision)
    expect(second.type).toBe(VTA_TASK.consentDecision02)
    expect(second.payload).toEqual(first.payload)
  })

  it('is not re-sent in another version when the agent refuses the decision itself', async () => {
    const { vta, sent } = agentServing(V01, () => {
      throw new VtiRefusal('task-consent/decision:challengeExpired', 'expired')
    })
    await expect(
      vta.decideConsent({ challenge: 'c'.repeat(32), payloadDigest: DIGEST }, 'deny', 'not me')
    ).rejects.toThrow('expired')
    expect(sent().map((s) => s.type)).toEqual([VTA_TASK.consentDecision])
  })
})
