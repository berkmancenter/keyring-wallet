/**
 * How the client decides whether an agent serves `vta/pcs/*` — and what it
 * refuses to conclude from a refusal.
 *
 * The tempting shortcut, which these tests exist to prevent: at 0.60 the
 * capability is checked *inside* `handle_applications_show`, so a
 * `permissionDenied` means the handler ran and the family is implemented. True
 * at 0.60, and unsafe as a rule — the policy gate runs **before** dispatch on
 * older agents, and with `policy.enforcement` on a denial for an unknown type
 * is also `permissionDenied`, as is a policy-store failure, which fails closed
 * with "policy evaluation unavailable"
 * (`vta-service/src/trust_tasks/policy_gate.rs:123-141` at
 * vta-service-v0.56.0). A pre-0.60 agent can therefore refuse that way for a
 * task it has never heard of, and treating it as "serves it" would offer
 * hidden vetting on an agent that cannot do it.
 *
 * So discovery answers the question, and the probe is only a fallback.
 */
import { VtaClient } from '../module/VtaClient'
import { DISCOVERY_TASK, PCS_VTA_TASK } from '../module/pcsVtaPayloads'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

/** A client whose task dispatch is scripted per type URI. */
function clientWith(script: (uri: string) => Promise<unknown>) {
  const client = Object.create(VtaClient.prototype) as VtaClient
  const asked: string[] = []
  Object.assign(client, {
    task: async (uri: string) => {
      asked.push(uri)
      return script(uri)
    },
  })
  return { client, asked }
}

const refusal = (code: string) => Object.assign(new Error(code), { document: { payload: { code } } })

describe('what the agent says it serves', () => {
  it('reads the family out of discovery, and asks nothing else', async () => {
    const { client, asked } = clientWith(async () => ({
      supportedTypes: ['https://trusttasks.org/spec/vta/pcs/applications/show/0.1'],
    }))
    expect(await client.servesPcs()).toBe(true)
    // No probe: discovery answered, so dispatching a task that could wake an
    // approver would be gratuitous.
    expect(asked).toEqual([DISCOVERY_TASK])
  })

  it('accepts the object form as well as the bare URI', async () => {
    // One list may hold both shapes (spec 0.1 `supportedTypes`).
    const { client } = clientWith(async () => ({
      supportedTypes: [
        { type: 'https://trusttasks.org/spec/vta/pcs/prove/0.1' },
        'https://trusttasks.org/spec/acl/list/0.1',
      ],
    }))
    expect(await client.servesPcs()).toBe(true)
  })

  it('says no when discovery answers and the family is absent', async () => {
    const { client, asked } = clientWith(async () => ({
      supportedTypes: ['https://trusttasks.org/spec/acl/list/0.1'],
    }))
    expect(await client.servesPcs()).toBe(false)
    expect(asked).toEqual([DISCOVERY_TASK])
  })
})

describe('the probe, only when discovery cannot answer', () => {
  it('falls back when discovery is not served, and reads notFound as yes', async () => {
    const { client, asked } = clientWith(async (uri) => {
      if (uri === DISCOVERY_TASK) throw refusal('unsupportedType')
      throw refusal('vta/pcs/applications/show:notFound')
    })
    expect(await client.servesPcs()).toBe(true)
    expect(asked).toEqual([DISCOVERY_TASK, PCS_VTA_TASK.applicationsShow])
  })

  it('reads unsupportedType on the probe as no', async () => {
    const { client } = clientWith(async () => {
      throw refusal('unsupportedType')
    })
    expect(await client.servesPcs()).toBe(false)
  })

  it('refuses to read permissionDenied either way', async () => {
    // The whole point of this file. An old agent with enforcement on can say
    // this about a task it does not implement.
    const { client } = clientWith(async (uri) => {
      if (uri === DISCOVERY_TASK) throw refusal('permissionDenied')
      throw refusal('permissionDenied')
    })
    expect(await client.servesPcs()).toBeUndefined()
  })

  it('is inconclusive for a refusal it does not recognise', async () => {
    const { client } = clientWith(async () => {
      throw refusal('somethingElse')
    })
    expect(await client.servesPcs()).toBeUndefined()
  })
})
