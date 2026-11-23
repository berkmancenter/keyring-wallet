import { checkVtaReply } from '../module/vtaReplyProof'

// What vta-sdk's client checks on every reply (VtaClient::verify_reply, VTI
// afcf2470 vta-sdk/src/client/mod.rs:2177-2245): an error document is exempt;
// otherwise the proof must verify AND its proven signer must be the agent this
// client is talking to. Keyring logs the verdict first and refuses nothing.
const VTA = 'did:webvh:Qm1:vta.example'
const agent = {} as never
const reply = (type: string, proof?: unknown) => ({ type, threadId: 'urn:uuid:t', payload: {}, ...(proof ? { proof } : {}) })

describe('checkVtaReply', () => {
  it('exempts an error document, whose proof is only RECOMMENDED', async () => {
    const verify = jest.fn()
    const verdict = await checkVtaReply(agent, reply('https://trusttasks.org/spec/trust-task-error/0.5'), VTA, verify)
    expect(verdict).toEqual({ kind: 'exempt' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('is verified when the proof verifies and the VTA signed it', async () => {
    const verify = jest.fn(async () => ({ ok: true as const, signer: VTA }))
    const verdict = await checkVtaReply(agent, reply('https://trusttasks.org/spec/auth/whoami/0.1#response', {}), VTA, verify)
    expect(verdict).toEqual({ kind: 'verified', signer: VTA })
  })

  it('is signed-by-another when a real proof names a different signer', async () => {
    const verify = jest.fn(async () => ({ ok: true as const, signer: 'did:key:z6Mkother' }))
    const verdict = await checkVtaReply(agent, reply('https://trusttasks.org/spec/auth/whoami/0.1#response', {}), VTA, verify)
    expect(verdict).toEqual({ kind: 'wrongSigner', signer: 'did:key:z6Mkother' })
  })

  it('is unsigned when there is no proof', async () => {
    const verify = jest.fn(async () => ({ ok: false as const, reason: 'unsigned' as const, detail: 'no proof' }))
    const verdict = await checkVtaReply(agent, reply('https://trusttasks.org/spec/auth/whoami/0.1#response'), VTA, verify)
    expect(verdict).toEqual({ kind: 'unsigned' })
  })

  it('is invalid when the proof does not verify, with why', async () => {
    const verify = jest.fn(async () => ({ ok: false as const, reason: 'proof' as const, detail: 'signature does not verify' }))
    const verdict = await checkVtaReply(agent, reply('https://trusttasks.org/spec/auth/whoami/0.1#response', {}), VTA, verify)
    expect(verdict).toEqual({ kind: 'invalid', detail: 'signature does not verify' })
  })

  it('never throws: a verifier that fails is reported, not raised', async () => {
    const verify = jest.fn(async () => Promise.reject(new Error('resolver offline')))
    const verdict = await checkVtaReply(agent, reply('https://trusttasks.org/spec/auth/whoami/0.1#response', {}), VTA, verify)
    expect(verdict).toEqual({ kind: 'invalid', detail: 'resolver offline' })
  })
})
