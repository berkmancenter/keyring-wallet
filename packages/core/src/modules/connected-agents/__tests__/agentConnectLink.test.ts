/**
 * The `agent-connect` trigger flow, the P0 fallback's code (plan §3.2, §7.2): behind its developer flag, a `did:key`
 * contact, at most 251 bytes, at most 5 minutes ahead.
 */
import { setAgentConnectEnabled } from '../agentConnectFlag'
import { pairingLinkFromTrigger } from '../pairing'
import {
  AGENT_CONNECT_FLOW,
  AGENT_CONNECT_MAX_LINK_BYTES,
  readTrigger,
  triggerAction,
  utf8ByteLength,
  type TriggerAccept,
} from '../../trust-tasks/module/triggerLink'

const now = 1791460800
const K_T = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const ID = 'q3Vn7Zk2Xo9Rt1LwPb4HdA'
const TYPE = `${AGENT_CONNECT_FLOW}/0.1`

const link = (fields: { from?: string; exp?: number; pad?: number; type?: string } = {}) =>
  `https://link.trustoverip.org/t#_from=${fields.from ?? K_T}&_id=${ID}&_exp=${fields.exp ?? now + 120}&_type=${
    fields.type ?? TYPE
  }${fields.pad ? `&_x=${'a'.repeat(fields.pad)}` : ''}`

afterEach(() => setAgentConnectEnabled(false))

describe('with the flag off', () => {
  it('the flow is unknown and answered as any flow this build does not know', () => {
    expect(readTrigger(link(), { now })).toEqual({ outcome: 'reject', reason: 'unknown-flow', ui: 'update' })
  })
})

describe('with the flag on', () => {
  beforeEach(() => setAgentConnectEnabled(true))

  it("reads the agent's did:key, and the scanner does not carry it through (only the connect screen does)", () => {
    const read = readTrigger(link(), { now })
    expect(read).toMatchObject({ outcome: 'accept', from: K_T, id: ID, flow: 'agent-connect' })
    expect(triggerAction(read)).toEqual({ kind: 'say', ui: 'update' })
    expect(pairingLinkFromTrigger(read as TriggerAccept)).toEqual({
      kind: 'fallback',
      agentDid: K_T,
      requestId: ID,
      exp: now + 120,
    })
  })

  it('refuses a link over 251 bytes, and takes one of exactly 251', () => {
    const base = utf8ByteLength(link({ pad: 1 })) - 1
    const exact = link({ pad: AGENT_CONNECT_MAX_LINK_BYTES - base })
    const over = link({ pad: AGENT_CONNECT_MAX_LINK_BYTES - base + 1 })
    expect(utf8ByteLength(exact)).toBe(251)
    expect(readTrigger(exact, { now }).outcome).toBe('accept')
    expect(readTrigger(over, { now })).toMatchObject({ outcome: 'reject', reason: 'too-long' })
  })

  it('refuses a lifetime over 300 seconds, allowing for the clock, and takes 300', () => {
    expect(readTrigger(link({ exp: now + 300 }), { now }).outcome).toBe('accept')
    expect(readTrigger(link({ exp: now + 300 + 61 }), { now })).toMatchObject({ reason: 'exp-too-far' })
  })

  it('requires an expiry', () => {
    const noExp = `https://link.trustoverip.org/t#_from=${K_T}&_id=${ID}&_type=${TYPE}`
    expect(readTrigger(noExp, { now })).toMatchObject({ reason: 'missing-exp' })
  })

  it('takes a did:key only', () => {
    expect(readTrigger(link({ from: 'did:webvh:QmCommScid:portal.community.example' }), { now })).toMatchObject({
      reason: 'from-not-allowed',
    })
  })

  it("does not hold the VTA's own sign-in-flow link to 251 bytes (TODO 0.1(h))", () => {
    const signIn = link({
      from: 'did:webvh:QmCommScid:vta.example.org',
      type: 'https://link.trustoverip.org/vti/flow/sign-in/0.1',
      pad: 120,
    })
    expect(utf8ByteLength(signIn)).toBeGreaterThan(251)
    const read = readTrigger(signIn, { now })
    expect(read).toMatchObject({ outcome: 'accept', flow: 'sign-in' })
    expect(pairingLinkFromTrigger(read as TriggerAccept)).toMatchObject({ kind: 'oob' })
  })
})

describe('utf8ByteLength', () => {
  it('counts UTF-8 bytes, not code points', () => {
    expect(utf8ByteLength('a')).toBe(1)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('☕')).toBe(3)
    expect(utf8ByteLength('𝄞')).toBe(4)
  })
})
