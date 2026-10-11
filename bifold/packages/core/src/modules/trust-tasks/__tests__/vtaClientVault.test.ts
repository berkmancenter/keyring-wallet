/**
 * The VtaClient calls trigger-link sign-in makes on the member's VTA:
 * `vault/sign-trust-task` (0.2 first, not held for consent), `vault/list`,
 * `vault/upsert` (0.1 first, as vta-sdk's own client), and sealing a vault
 * secret to the VTA as a `didcomm-authcrypt` JWE from the manager identity.
 */
import { VAULT_SECRET_MESSAGE_TYPE, VTA_TASK, VtaClient } from '../module/VtaClient'
import { AGENT_DEVICE_TASK } from '../module/vtaDevices'
import { vtaSignInPort } from '../module/oobSignInAgent'
import { authcryptTo } from '../module/VtiMediatorTransport'
import { VtiRefusal } from '../module/vtiAgent'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))
jest.mock('../module/VtiMediatorTransport', () => ({
  ...jest.requireActual('../module/VtiMediatorTransport'),
  authcryptTo: jest.fn(async () => ({ protected: 'eyJ…', recipients: [], iv: 'i', ciphertext: 'c', tag: 't' })),
}))

const VTA = 'did:webvh:agent'
const PHONE = 'did:peer:2.phone'

function client() {
  const vta = new VtaClient({ config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never, VTA, {} as never, {})
  jest.spyOn(vta, 'managerDid', 'get').mockReturnValue(PHONE)
  return vta
}

describe("the sign-in's VTA calls", () => {
  it('signs a trust task at 0.2, steps down to 0.1, and never waits for consent', async () => {
    const vta = client()
    const signed = { id: 'urn:uuid:x', proof: { proofPurpose: 'authentication' } }
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(
        new VtiRefusal('unsupportedVersion', 'no', { servedVersions: [VTA_TASK.vaultSignTrustTask] })
      )
      .mockResolvedValueOnce({ signedEnvelope: signed })
    const ext = { 'org.openvtc.uv-consent': { decision: { id: 'd' } } }
    await expect(vta.signTrustTask({ entryId: 'vault_1', unsignedEnvelope: { id: 'urn:uuid:x' }, ext })).resolves.toBe(
      signed
    )
    expect(task.mock.calls.map((c) => c[0])).toEqual([VTA_TASK.vaultSignTrustTask02, VTA_TASK.vaultSignTrustTask])
    expect(task.mock.calls[1][1]).toEqual({ entryId: 'vault_1', unsignedEnvelope: { id: 'urn:uuid:x' }, ext })
    expect(task.mock.calls[1][5]).toEqual({ waitForConsent: false })
  })

  it('refuses an answer without a signed envelope', async () => {
    const vta = client()
    jest.spyOn(vta, 'task').mockResolvedValueOnce({})
    await expect(vta.signTrustTask({ entryId: 'vault_1', unsignedEnvelope: {} })).rejects.toThrow(/signedEnvelope/)
  })

  it('lists and upserts vault entries at 0.1', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockResolvedValueOnce({ entries: [{ id: 'vault_1' }], truncated: false })
      .mockResolvedValueOnce({ entry: { id: 'vault_2' }, created: true })
    await expect(vta.vaultList({ targetDid: 'did:web:vtc' })).resolves.toEqual([{ id: 'vault_1' }])
    await expect(vta.vaultUpsert({ label: 'x' })).resolves.toEqual({ entry: { id: 'vault_2' }, created: true })
    expect(task.mock.calls.map((c) => c[0])).toEqual([VTA_TASK.vaultList, VTA_TASK.vaultUpsert])
  })

  it('seals a vault secret to the VTA from the manager identity, as a didcomm-authcrypt JWE', async () => {
    const vta = client()
    const identity = { did: PHONE, kid: `${PHONE}#key-2`, senderKey: {} }
    Object.assign(vta as unknown as Record<string, unknown>, { identity, session: { isOpen: true } })
    const secret = { kind: 'did-self-issued', did: 'did:webvh:persona', signingKeyId: 'did:webvh:persona#key-0' }
    const sealed = await vta.sealVaultSecret(secret)
    expect(authcryptTo).toHaveBeenCalledWith(
      expect.anything(),
      identity,
      VTA,
      expect.objectContaining({ type: VAULT_SECRET_MESSAGE_TYPE, from: PHONE, to: [VTA], body: secret })
    )
    expect(sealed.envelope).toBe('didcomm-authcrypt')
    expect(JSON.parse(sealed.jwe)).toMatchObject({ ciphertext: 'c' })
    expect(sealed.jwe).not.toContain('signingKeyId')
  })

  it('does not seal without a session', async () => {
    await expect(client().sealVaultSecret({ kind: 'did-self-issued' })).rejects.toThrow(/not connected/)
  })
})

describe("the sign-in's port onto VtaClient", () => {
  const ext = { 'org.openvtc.uv-key': { kind: 'hardwareKey', did: 'did:key:z6MkUv' } }

  it('beats with the extension, and registers the phone with it', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockResolvedValue({})
    const port = vtaSignInPort(vta, { platform: 'ios', now: () => new Date(2026, 9, 11) })
    expect(port.did).toBe(VTA)
    await port.heartbeat(ext)
    await expect(port.register(ext)).resolves.toBe('registered')
    expect(task.mock.calls[0].slice(0, 2)).toEqual([AGENT_DEVICE_TASK.heartbeat, { ext }])
    expect(task.mock.calls[1].slice(0, 2)).toEqual([
      AGENT_DEVICE_TASK.register,
      {
        consumerKind: { kind: 'companion', formFactor: 'mobile' },
        displayName: 'iPhone · added 11 Oct',
        platform: 'ios',
        ext,
      },
    ])
  })

  it('says alreadyRegistered when the agent does', async () => {
    const vta = client()
    jest
      .spyOn(vta, 'task')
      .mockRejectedValue(new VtiRefusal('conflict', 'device/register:alreadyRegistered — did:peer:2.phone'))
    await expect(vtaSignInPort(vta, { platform: 'ios' }).register(ext)).resolves.toBe('alreadyRegistered')
  })
})
