/**
 * The owner-code screen names the person's own lock, not always "Face ID"
 * (own_agent_subtask.md §7): Touch ID on older iPhones, a fingerprint or face
 * unlock on Android, the screen lock when there is no biometry, and a neutral
 * fallback when the phone cannot say.
 */
import * as Keychain from 'react-native-keychain'

import { lockKindFrom, ownerLockKind } from '../module/ownerConfirm'

describe('what protects the owner code, in the person’s own words', () => {
  test('an Android phone with a fingerprint says fingerprint, not Face ID', () => {
    expect(lockKindFrom('Fingerprint', true)).toBe('fingerprint')
  })

  test('each biometry the keychain reports has its own name', () => {
    expect(lockKindFrom('FaceID', true)).toBe('faceId')
    expect(lockKindFrom('TouchID', true)).toBe('touchId')
    expect(lockKindFrom('Face', true)).toBe('face')
    expect(lockKindFrom('Iris', true)).toBe('iris')
  })

  test('no biometry but a passcode is the screen lock; nothing known is the neutral fallback', () => {
    expect(lockKindFrom(null, true)).toBe('screenLock')
    expect(lockKindFrom(null, false)).toBe('unknown')
    expect(lockKindFrom(undefined, false)).toBe('unknown')
  })

  test('read from the phone: an Android fingerprint, and a phone that cannot say', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValueOnce('Fingerprint')
    expect(await ownerLockKind()).toBe('fingerprint')
    ;(Keychain.getSupportedBiometryType as jest.Mock).mockRejectedValueOnce(new Error('no'))
    expect(await ownerLockKind()).toBe('unknown')
  })

  test('every lock has words in each language, and nothing always says Face ID', () => {
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../../localization/${lang}/${lang}.json`).CreateAgent
      for (const kind of ['faceId', 'touchId', 'opticId', 'fingerprint', 'face', 'iris', 'screenLock', 'unknown']) {
        expect(typeof copy.Lock[kind]).toBe('string')
      }
      expect(copy.OwnerBody).toContain('{{method}}')
      expect(copy.OwnerBody).not.toMatch(/Face ID/)
      expect(copy.Lock.fingerprint).not.toMatch(/Face ID/)
      expect(typeof copy.NeedsScreenLockIos).toBe('string')
      expect(copy.NeedsScreenLockAndroid).not.toMatch(/Face ID/)
    }
  })
})
