/**
 * The VtaClient calls trigger-link sign-in makes on the member's VTA:
 * `vault/sign-trust-task` (0.2 first, not held for consent), `vault/list`,
 * `vault/upsert` (0.3 first: every VTA in use serves it), each spelled for the
 * version it is sent in, and sealing a vault secret to the VTA as a
 * `didcomm-authcrypt` JWE from the manager identity.
 */
import Ajv from 'ajv/dist/2020'
import { PAYLOAD_SCHEMA as UPSERT_0_3 } from '@openvtc/trust-tasks/vault/upsert/0.3/payload'
import { PAYLOAD_SCHEMA as UPSERT_0_4 } from '@openvtc/trust-tasks/vault/upsert/0.4/payload'

import { VAULT_SECRET_MESSAGE_TYPE, VTA_TASK, VtaClient, vaultPayloadFor } from '../module/VtaClient'
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

const logger = { info: jest.fn(), warn: jest.fn() }

function client() {
  const vta = new VtaClient({ config: { logger } } as never, VTA, {} as never, {})
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

  it('lists and upserts vault entries at 0.4, and logs the version each was answered in', async () => {
    logger.info.mockClear()
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockResolvedValueOnce({ entries: [{ id: 'vault_1' }] })
      .mockResolvedValueOnce({ entry: { id: 'vault_2' }, wasCreated: true })
    await expect(vta.vaultList({ targetDid: 'did:web:vtc' })).resolves.toEqual([{ id: 'vault_1' }])
    await expect(vta.vaultUpsert({ label: 'x' })).resolves.toEqual({ entry: { id: 'vault_2' }, created: true })
    expect(task.mock.calls.map((c) => c[0])).toEqual([VTA_TASK.vaultList04, VTA_TASK.vaultUpsert04])
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`vaultList answered in ${VTA_TASK.vaultList04}`))
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`vaultUpsert answered in ${VTA_TASK.vaultUpsert04}`)
    )
  })

  // The sign-in's entry, built in 0.1's spelling as ensureSignInVaultEntry builds it.
  const signInEntry = {
    contextId: 'personal',
    targets: [{ kind: 'did', did: 'did:web:vtc' }],
    label: 'Keyring sign-in',
    secretKind: 'did-self-issued',
    sealedSecret: { envelope: 'didcomm-authcrypt' as const, jwe: '{"ciphertext":"c"}' },
  }

  it("sends the sign-in's entry at 0.4 in its spelling, which 0.4's and 0.3's own schemas accept", async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockResolvedValueOnce({ entry: { id: 'vault_3' }, wasCreated: true })
    await vta.vaultUpsert(signInEntry)
    const [type, sent] = task.mock.calls[0]
    expect(type).toBe(VTA_TASK.vaultUpsert04)
    const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
    expect(ajv.compile(UPSERT_0_4 as object)(sent)).toBe(true)
    const valid = ajv.compile(UPSERT_0_3 as object)
    expect(valid(sent)).toBe(true)
    // The control: the same entry as built, in 0.1's spelling, is what 0.3 refuses.
    expect(valid(signInEntry)).toBe(false)
    expect(sent).toMatchObject({ secretKind: 'didSelfIssued', sealedSecret: { envelope: 'didcommAuthcrypt' } })
  })

  it('steps down 0.4 → 0.3 → 0.2 → 0.1 on version refusals, each in its own spelling', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(new VtiRefusal('unsupportedVersion', 'no'))
      .mockRejectedValueOnce(new VtiRefusal('unsupportedVersion', 'no'))
      .mockRejectedValueOnce(new VtiRefusal('unsupportedVersion', 'no'))
      .mockResolvedValueOnce({ entry: { id: 'vault_4' } })
    await vta.vaultUpsert(signInEntry)
    expect(task.mock.calls.map((c) => c[0])).toEqual([
      VTA_TASK.vaultUpsert04,
      VTA_TASK.vaultUpsert03,
      VTA_TASK.vaultUpsert02,
      VTA_TASK.vaultUpsert,
    ])
    expect(task.mock.calls.map((c) => (c[1] as { secretKind: string }).secretKind)).toEqual([
      'didSelfIssued',
      'didSelfIssued',
      'didSelfIssued',
      'did-self-issued',
    ])
  })

  it('never retries in another version when the refusal is about the request itself', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockRejectedValueOnce(new VtiRefusal('forbidden', 'not yours'))
    await expect(vta.vaultUpsert(signInEntry)).rejects.toThrow(/not yours/)
    expect(task).toHaveBeenCalledTimes(1)
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

describe('vaultPayloadFor', () => {
  const entry = {
    secretKind: 'did-self-issued',
    targets: [
      { kind: 'web-origin', origin: 'https://x' },
      { kind: 'did', did: 'did:web:v' },
    ],
    sealedSecret: { envelope: 'didcomm-authcrypt', jwe: 'j' },
    label: 'keep-me-as-is',
  }

  it("leaves 0.1's spelling at 0.1, and changes nothing that has no camel form", () => {
    expect(vaultPayloadFor(VTA_TASK.vaultUpsert, entry)).toEqual(entry)
    expect(vaultPayloadFor(VTA_TASK.vaultUpsert03, { secretKind: 'custom' })).toEqual({ secretKind: 'custom' })
  })

  it('spells 0.2 and 0.3 in camel case, without touching other fields or the input', () => {
    for (const uri of [VTA_TASK.vaultUpsert02, VTA_TASK.vaultUpsert03, VTA_TASK.vaultList03]) {
      expect(vaultPayloadFor(uri, entry)).toEqual({
        secretKind: 'didSelfIssued',
        targets: [
          { kind: 'webOrigin', origin: 'https://x' },
          { kind: 'did', did: 'did:web:v' },
        ],
        sealedSecret: { envelope: 'didcommAuthcrypt', jwe: 'j' },
        label: 'keep-me-as-is',
      })
    }
    expect(entry.secretKind).toBe('did-self-issued')
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
    expect(task.mock.calls[0].slice(0, 2)).toEqual([AGENT_DEVICE_TASK.heartbeat03, { ext }])
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

  // IN-390 (276.9): a website sign-in beats before every grant, and it beat only at device/heartbeat/0.2. From
  // vta-service 0.67 (#2309) the agent serves heartbeat only at 0.3, refused 0.2 as unsupportedVersion, and the
  // sign-in ended "Your agent needs an update" before any grant was asked, with the agent the current side.
  const beatsAt = (served: string) => (type: string) =>
    type === served || !type.includes('/device/heartbeat/')
      ? Promise.resolve({})
      : Promise.reject(new VtiRefusal('unsupportedVersion', `device/heartbeat: ${type} is not served`))

  it('beats an agent that serves only heartbeat 0.3 (vta-service 0.67) at 0.3, so the sign-in goes on', async () => {
    const vta = client()
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue('did:peer:2.phone-on-067')
    const task = jest.spyOn(vta, 'task').mockImplementation(beatsAt(AGENT_DEVICE_TASK.heartbeat03) as never)
    await expect(vtaSignInPort(vta, { platform: 'ios' }).heartbeat(ext)).resolves.toBeUndefined()
    expect(task.mock.calls.map(([type]) => type)).toEqual([AGENT_DEVICE_TASK.heartbeat03])
    expect(task.mock.calls[0][1]).toEqual({ ext })
  })

  it('beats an agent from before 0.3 (vta-service 0.66) at 0.2, once 0.3 is refused', async () => {
    const vta = client()
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue('did:peer:2.phone-on-066')
    const task = jest.spyOn(vta, 'task').mockImplementation(beatsAt(AGENT_DEVICE_TASK.heartbeat) as never)
    await expect(vtaSignInPort(vta, { platform: 'ios' }).heartbeat(ext)).resolves.toBeUndefined()
    expect(task.mock.calls.map(([type]) => type)).toEqual([AGENT_DEVICE_TASK.heartbeat03, AGENT_DEVICE_TASK.heartbeat])
    expect(task.mock.calls[1][1]).toEqual({ ext })
  })

  it('remembers what the agent serves: a pre-0.3 agent pays the refused 0.3 beat once, not before every grant', async () => {
    const vta = client()
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue('did:peer:2.phone-on-066-twice')
    const task = jest.spyOn(vta, 'task').mockImplementation(beatsAt(AGENT_DEVICE_TASK.heartbeat) as never)
    const port = vtaSignInPort(vta, { platform: 'ios' })
    await port.heartbeat(ext)
    await port.heartbeat(ext)
    expect(task.mock.calls.map(([type]) => type)).toEqual([
      AGENT_DEVICE_TASK.heartbeat03,
      AGENT_DEVICE_TASK.heartbeat,
      AGENT_DEVICE_TASK.heartbeat,
    ])
  })

  it('steps down only for a version the agent does not serve: any other refusal at 0.3 is the answer', async () => {
    const vta = client()
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue('did:peer:2.phone-other-refusal')
    const refused = new VtiRefusal('permissionDenied', 'device/heartbeat: forbidden')
    const task = jest.spyOn(vta, 'task').mockRejectedValue(refused)
    await expect(vtaSignInPort(vta, { platform: 'ios' }).heartbeat(ext)).rejects.toBe(refused)
    // Not retried at 0.2, which a 0.67 agent refuses as unsupportedVersion: that would read as "needs an update".
    expect(task.mock.calls.map(([type]) => type)).toEqual([AGENT_DEVICE_TASK.heartbeat03])
  })

  it('says alreadyRegistered when the agent does', async () => {
    const vta = client()
    jest
      .spyOn(vta, 'task')
      .mockRejectedValue(new VtiRefusal('conflict', 'device/register:alreadyRegistered — did:peer:2.phone'))
    await expect(vtaSignInPort(vta, { platform: 'ios' }).register(ext)).resolves.toBe('alreadyRegistered')
  })
})
