/**
 * A task-consent request, read as upstream reads one (VTI afcf2470):
 *  - the match code is vta_sdk `task_consent::match_code` — the first six hex
 *    characters of the DIGEST BYTES, never of the multibase string, so the
 *    phone shows the code the requesting screen shows;
 *  - what the task would do is the VTA's dry-run `effects`, else the task's
 *    `consequences`, and when both are empty the screen says it could not tell
 *    — never "no effects" (vta-mobile-core `consent.rs`);
 *  - the request is checked as `ConsentRequest::verify` checks it: a valid
 *    proof for `authentication`, signed by its issuer, that issuer the linked
 *    agent, addressed to this phone, not expired. Log-only for now: a request
 *    that fails is still listed, and the failure is logged.
 */
import { DidKey, MultiBaseEncoder, TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signDocumentProof } from '@bifold/trust-tasks'

import { checkConsentRequest, consentMatchCode, consentOutcome } from '../module/consentCheck'
import { VTA_TASK } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'

jest.mock('../module/VtiMediatorTransport', () => ({}))

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

function didKeySigner() {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const verificationMethodId = DidKey.fromDid(did).didDocument.verificationMethod?.[0]?.id as string
  const agent = {
    config: { logger },
    dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }),
      }),
    },
  }
  return { did, verificationMethodId, agent }
}

const digestOf = (first: number[]) => {
  const bytes = new Uint8Array(32)
  bytes.set(first)
  return MultiBaseEncoder.encode(new Uint8Array([0x12, 0x20, ...bytes]), 'base58btc')
}

const vta = didKeySigner()
const other = didKeySigner()
const PHONE = 'did:key:z6MkphoneManager'
// The proofs are made now, and a proof `created` ahead of the clock is refused.
const NOW = new Date()
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString()

const requestDoc = (overrides: { issuer?: string; recipient?: string; expiresAt?: string } = {}) => ({
  id: 'urn:uuid:consent-request-1',
  type: VTA_TASK.consentRequest,
  issuer: overrides.issuer ?? vta.did,
  recipient: overrides.recipient ?? PHONE,
  issuedAt: inMinutes(-1),
  payload: {
    challenge: 'c'.repeat(32),
    taskType: 'https://trusttasks.org/spec/keys/export-secret/0.1',
    payloadDigest: digestOf([0xab, 0xcd, 0xef]),
    requester: 'did:key:z6MkRequester',
    approverSet: 'owners',
    minApprovals: 1,
    expiresAt: overrides.expiresAt ?? inMinutes(5),
  },
})

const signed = (
  signer: ReturnType<typeof didKeySigner>,
  doc: Record<string, unknown>,
  proofPurpose: 'authentication' | 'assertionMethod' = 'authentication'
) =>
  signDocumentProof(signer.agent as never, doc, signer.did, {
    kmsKeyId: 'sig',
    verificationMethodId: signer.verificationMethodId,
    proofPurpose,
  })

const check = (doc: Record<string, unknown>) =>
  checkConsentRequest(vta.agent as never, doc, { vtaDid: vta.did, approver: PHONE, now: NOW })

describe('the match code, as vta_sdk task_consent::match_code', () => {
  it('reads the digest bytes, not the encoding', () => {
    const digest = digestOf([0xab, 0xcd, 0xef])
    expect(digest.startsWith('zQm')).toBe(true)
    expect(consentMatchCode(digest)).toBe('abcdef')
  })

  it('has none for a digest that is not a 32-byte sha2-256 multihash', () => {
    expect(consentMatchCode('not-multibase!')).toBeUndefined()
    expect(
      consentMatchCode(MultiBaseEncoder.encode(new Uint8Array([0x12, 0x20, 1, 2, 3]), 'base58btc'))
    ).toBeUndefined()
    expect(
      consentMatchCode(MultiBaseEncoder.encode(new Uint8Array([0x13, 0x20, ...new Uint8Array(32)]), 'base58btc'))
    ).toBeUndefined()
    expect(consentMatchCode(undefined)).toBeUndefined()
  })
})

describe('what approving would do', () => {
  it('lists the dry-run effects by their summary, whatever their kind', () => {
    expect(
      consentOutcome({
        effects: [
          { kind: 'keys.export', summary: 'Hands a copy of the signing key to the requester' },
          { kind: 'a-kind-this-phone-does-not-know', summary: 'Does something new' },
        ],
        consequences: ['Static text the dry run replaces'],
      })
    ).toEqual({
      from: 'effects',
      lines: ['Hands a copy of the signing key to the requester', 'Does something new'],
    })
  })

  it('falls back to the consequences when there are no effects', () => {
    expect(consentOutcome({ effects: [], consequences: ['The requester can sign as you'] })).toEqual({
      from: 'consequences',
      lines: ['The requester can sign as you'],
    })
  })

  it('says it cannot tell when there are neither — never "no effects"', () => {
    expect(consentOutcome({})).toEqual({ from: 'unknown' })
    expect(consentOutcome({ effects: [{ kind: '', summary: '' }], consequences: [' '] })).toEqual({ from: 'unknown' })
  })
})

describe('checking the request, as ConsentRequest::verify', () => {
  it('passes a request the linked agent signed for this phone', async () => {
    await expect(check(await signed(vta, requestDoc()))).resolves.toEqual({ ok: true })
  })

  it('refuses one without a proof', async () => {
    await expect(check(requestDoc())).resolves.toEqual({ ok: false, reason: 'unsigned' })
  })

  it('refuses one changed after it was signed', async () => {
    const doc = await signed(vta, requestDoc())
    const changed = { ...doc, payload: { ...(doc.payload as object), taskType: 'https://example.org/other' } }
    await expect(check(changed)).resolves.toEqual({ ok: false, reason: 'proof' })
  })

  it('refuses one signed for the wrong purpose', async () => {
    await expect(check(await signed(vta, requestDoc(), 'assertionMethod'))).resolves.toEqual({
      ok: false,
      reason: 'wrong-purpose',
    })
  })

  it('refuses one whose signer is not its issuer', async () => {
    await expect(check(await signed(other, requestDoc()))).resolves.toEqual({ ok: false, reason: 'signer-not-issuer' })
  })

  it('refuses one from anyone but the linked agent', async () => {
    await expect(check(await signed(other, requestDoc({ issuer: other.did })))).resolves.toEqual({
      ok: false,
      reason: 'wrong-issuer',
    })
  })

  it('refuses one addressed to someone else', async () => {
    await expect(check(await signed(vta, requestDoc({ recipient: 'did:key:z6MkSomeoneElse' })))).resolves.toEqual({
      ok: false,
      reason: 'wrong-recipient',
    })
  })

  it('refuses one that has expired', async () => {
    await expect(check(await signed(vta, requestDoc({ expiresAt: inMinutes(-0.1) })))).resolves.toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('refuses a document that is not a consent request', async () => {
    await expect(check(await signed(vta, { ...requestDoc(), type: VTA_TASK.consentDecision }))).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('an approval as the phone lists it', () => {
  const controllerWith = () => {
    const controller = new VtaAgentController()
    ;(controller as unknown as { current: unknown }).current = {
      vtaDid: vta.did,
      agent: vta.agent,
      client: { managerDid: PHONE },
    }
    return controller
  }
  const deliver = (controller: VtaAgentController, body: Record<string, unknown>) =>
    (controller as unknown as { inbound: (m: unknown) => void }).inbound({ body })
  const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

  beforeEach(() => logger.warn.mockClear())

  it('carries the match code and what approving would do', async () => {
    const controller = controllerWith()
    const doc = await signed(vta, requestDoc())
    deliver(controller, { ...doc, payload: { ...(doc.payload as object) } })
    expect(controller.getState().approvals[0]).toMatchObject({
      id: 'urn:uuid:consent-request-1',
      matchCode: 'abcdef',
      outcome: { from: 'unknown' },
      status: 'pending',
    })
  })

  it('still lists a request that fails the check, and logs why (log-only)', async () => {
    const controller = controllerWith()
    deliver(controller, requestDoc())
    await settled()
    expect(controller.getState().approvals).toHaveLength(1)
    expect(controller.getState().approvals[0].requestCheck).toBe('unsigned')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unsigned'))
  })

  it('records a request that passes the check', async () => {
    const controller = controllerWith()
    deliver(controller, await signed(vta, requestDoc()))
    await settled()
    expect(controller.getState().approvals[0].requestCheck).toBe('verified')
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
