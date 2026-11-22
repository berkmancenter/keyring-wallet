/**
 * The phone's UV key over a faked react-native-keychain: made once, named
 * without a prompt, readable only through the biometric prompt (current
 * biometrics, no passcode fallback), and refused when the item is gone.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import * as Keychain from 'react-native-keychain'

import { didKeyVerificationMethod, getUvDid, resetUvKey, uvSign, UvKeyError } from '../module/uvKey'

jest.mock('react-native-keychain', () => {
  const items = new Map<string, { username: string; password: string; options: Record<string, unknown> }>()
  return {
    __items: items,
    ACCESS_CONTROL: {
      BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
      BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
    },
    ACCESSIBLE: {
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    STORAGE_TYPE: { AES_GCM: 'KeystoreAESGCM' },
    setGenericPassword: jest.fn(async (username: string, password: string, options: { service: string }) => {
      items.set(options.service, { username, password, options })
      return { service: options.service, storage: 'keychain' }
    }),
    getGenericPassword: jest.fn(async (options: { service: string }) => {
      const item = items.get(options.service)
      return item ? { username: item.username, password: item.password, service: options.service } : false
    }),
    resetGenericPassword: jest.fn(async (options: { service: string }) => items.delete(options.service)),
  }
})

const mock = Keychain as unknown as {
  __items: Map<string, { username: string; password: string; options: Record<string, unknown> }>
  setGenericPassword: jest.Mock
  getGenericPassword: jest.Mock
}

const verifyWith = (did: string, bytes: Uint8Array, signature: Uint8Array) => {
  // did:key:z6Mk… → the raw public key after the 0xed01 prefix.
  const { TypedArrayEncoder } = jest.requireActual('@credo-ts/core')
  const raw = TypedArrayEncoder.fromBase58(did.slice('did:key:z'.length)).slice(2)
  return ed25519.verify(signature, bytes, raw)
}

const readItem = mock.getGenericPassword.getMockImplementation()!

beforeEach(async () => {
  mock.__items.clear()
  jest.clearAllMocks()
  mock.getGenericPassword.mockImplementation(readItem)
})

describe('the UV key', () => {
  it('is made once, behind current biometrics with no passcode fallback, and named without a prompt', async () => {
    const did = await getUvDid()
    expect(did).toMatch(/^did:key:z6Mk/)
    expect(didKeyVerificationMethod(did)).toBe(`${did}#${did.slice(8)}`)

    const secretItem = mock.__items.get('keyring.signin-uv-key')!
    expect(secretItem.options).toMatchObject({
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenPasscodeSetThisDeviceOnly',
      storage: 'KeystoreAESGCM',
    })
    expect(secretItem.password).toMatch(/^[0-9a-f]{64}$/)
    // The DID is kept apart, with no access control: naming the key reads only that.
    expect(mock.__items.get('keyring.signin-uv-key.did')!.options).not.toHaveProperty('accessControl')

    mock.getGenericPassword.mockClear()
    await expect(getUvDid()).resolves.toBe(did)
    expect(mock.setGenericPassword).toHaveBeenCalledTimes(2)
    expect(mock.getGenericPassword).toHaveBeenCalledWith({ service: 'keyring.signin-uv-key.did' })
    expect(mock.getGenericPassword).not.toHaveBeenCalledWith(
      expect.objectContaining({ service: 'keyring.signin-uv-key' })
    )
  })

  it('signs only by reading the key through the biometric prompt', async () => {
    const did = await getUvDid()
    const bytes = new Uint8Array(64).fill(1)
    const signature = await uvSign(bytes, 'Approve signing in')
    expect(mock.getGenericPassword).toHaveBeenCalledWith({
      service: 'keyring.signin-uv-key',
      accessControl: 'BiometryCurrentSet',
      authenticationPrompt: { title: 'Approve signing in' },
    })
    expect(verifyWith(did, bytes, signature)).toBe(true)
  })

  it('says cancelled when the person cancels the prompt', async () => {
    await getUvDid()
    mock.getGenericPassword.mockImplementation(async (options: { service: string }) => {
      if (options.service === 'keyring.signin-uv-key') throw new Error('User canceled the operation.')
      const item = mock.__items.get(options.service)
      return item ? { username: item.username, password: item.password } : false
    })
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'cancelled' })
  })

  it('says lost when biometrics changed and the item no longer reads, or there is no key', async () => {
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toBeInstanceOf(UvKeyError)
    await getUvDid()
    mock.__items.delete('keyring.signin-uv-key')
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'lost' })
  })

  it('says lost when the stored key is not the one its DID names', async () => {
    await getUvDid()
    mock.__items.get('keyring.signin-uv-key')!.password = '11'.repeat(32)
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'lost' })
  })

  it('is made afresh after a reset', async () => {
    const first = await getUvDid()
    await resetUvKey()
    const second = await getUvDid()
    expect(second).not.toBe(first)
  })
})
