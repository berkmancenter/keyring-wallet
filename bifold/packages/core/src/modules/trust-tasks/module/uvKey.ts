/**
 * uvKey — the phone's user-verification (UV) key for trigger-link sign-in:
 * the key whose signature tells the member's VTA that the person, not just
 * the app, approved a sign-in (`task-consent/decision/0.2` under
 * `ext["org.openvtc.uv-consent"]`; findings F3, ref-24).
 *
 * An Ed25519 key, kept with react-native-keychain behind biometric access
 * control: reading the secret back is what shows the system Face ID (or
 * fingerprint) prompt, and the OS refuses the read without it. It is NOT in
 * the Secure Enclave: the Enclave holds only P-256 keys, and the cryptosuite
 * for a P-256 decision is unspecified upstream (findings G6). So the
 * enrolment says `hardwareBacked: false` (oobSignInAgent.enrolUvKey).
 *
 * `BIOMETRY_CURRENT_SET`, not `BIOMETRY_ANY_OR_DEVICE_PASSCODE` (the owner
 * confirmation's, ownerConfirm.ts) and not `BIOMETRY_ANY`:
 *  - a passcode alone must not approve a sign-in — the UV key stands for a
 *    biometric (`biometricGated: true`, device_management.rs:141-142, which
 *    the VTA requires of a hardware UV key, :245-261);
 *  - with `BIOMETRY_ANY`, someone who learns the passcode can enrol their own
 *    face or finger and then approve. `CURRENT_SET` invalidates the item when
 *    the enrolled biometrics change. The cost: after such a change the key is
 *    gone ({@link UvKeyError} `lost`), and the phone makes a new one and
 *    enrols it again (a heartbeat replaces the UV key, vta-service
 *    operations/device.rs:252-272).
 *
 * The DID is kept beside it in an item with no access control, so naming the
 * key ({@link getUvDid}) never prompts on iOS. On Android, react-native-keychain's
 * biometric storage (`AES_GCM`) needs the biometric to encrypt as well, so
 * creating the key prompts once there.
 *
 * Used by the sign-in screen's Approve (oobSignInAgent.approveSignIn).
 *
 * @module trust-tasks/module/uvKey
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'
import * as Keychain from 'react-native-keychain'

const SECRET_SERVICE = 'keyring.signin-uv-key'
const PUBLIC_SERVICE = 'keyring.signin-uv-key.did'
const PUBLIC_USER = 'uv-did'

/** Why the UV key could not sign. */
export type UvKeyFailure = 'cancelled' | 'lost' | 'unavailable'

export class UvKeyError extends Error {
  constructor(
    readonly reason: UvKeyFailure,
    message: string
  ) {
    super(message)
    this.name = 'UvKeyError'
  }
}

/** Cancelling is said in words, not a shared code (as ownerConfirm.ts reads it). */
const CANCELLED = /cancel|negative button/i

/**
 * Read when a key is made or used, never at import: importing @bifold/core
 * must not touch a native module (a test's keychain mock, or a build without
 * the native side, has no constants to read).
 */
const accessControl = () => Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)))

/** An Ed25519 public key as a `did:key` (multicodec 0xed01, base58btc). */
export function ed25519DidKey(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(2 + publicKey.length)
  prefixed.set([0xed, 0x01], 0)
  prefixed.set(publicKey, 2)
  return `did:key:z${TypedArrayEncoder.toBase58(prefixed)}`
}

/** The verification method a `did:key` signs as: the DID, `#`, its own multibase. */
export const didKeyVerificationMethod = (did: string): string => `${did}#${did.slice('did:key:'.length)}`

async function storedDid(): Promise<string | undefined> {
  const item = await Keychain.getGenericPassword({ service: PUBLIC_SERVICE }).catch(() => false as const)
  return item && item.password.startsWith('did:key:') ? item.password : undefined
}

/** Make the key and keep it; answers its DID. The secret is wiped from memory once stored. */
async function createUvKey(prompt: string): Promise<string> {
  const secret = ed25519.utils.randomSecretKey()
  try {
    const did = ed25519DidKey(ed25519.getPublicKey(secret))
    const stored = await Keychain.setGenericPassword(did, toHex(secret), {
      service: SECRET_SERVICE,
      accessControl: accessControl(),
      // Never in a backup, never on another phone, gone with the passcode.
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      // Android: the Keystore key that encrypts it needs the biometric.
      storage: Keychain.STORAGE_TYPE.AES_GCM,
      authenticationPrompt: { title: prompt },
    })
    if (!stored) throw new UvKeyError('unavailable', 'the approval key could not be stored')
    await Keychain.setGenericPassword(PUBLIC_USER, did, {
      service: PUBLIC_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
    return did
  } finally {
    secret.fill(0)
  }
}

/**
 * The UV key's `did:key`, making the key the first time. Never shows a
 * prompt once the key exists.
 */
export async function getUvDid(prompt = 'Set up approving sign-ins on this phone'): Promise<string> {
  const known = await storedDid()
  if (known) return known
  try {
    return await createUvKey(prompt)
  } catch (error) {
    if (error instanceof UvKeyError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new UvKeyError(CANCELLED.test(message) ? 'cancelled' : 'unavailable', message)
  }
}

/**
 * Sign `bytes` with the UV key. Reading the key shows the system biometric
 * prompt with `prompt` as its title; without the person's face or finger
 * there is no signature. Answers the raw 64-byte Ed25519 signature.
 */
export async function uvSign(bytes: Uint8Array, prompt: string): Promise<Uint8Array> {
  const did = await storedDid()
  if (!did) throw new UvKeyError('lost', 'this phone has no approval key')
  let item: false | { username: string; password: string }
  try {
    item = await Keychain.getGenericPassword({
      service: SECRET_SERVICE,
      accessControl: accessControl(),
      authenticationPrompt: { title: prompt },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new UvKeyError(CANCELLED.test(message) ? 'cancelled' : 'unavailable', message)
  }
  // An item invalidated by a change of enrolled biometrics reads as absent.
  if (!item) throw new UvKeyError('lost', 'the approval key is no longer readable')
  const secret = fromHex(item.password)
  try {
    if (secret.length !== 32 || ed25519DidKey(ed25519.getPublicKey(secret)) !== did) {
      throw new UvKeyError('lost', 'the approval key does not match its DID')
    }
    return ed25519.sign(bytes, secret)
  } finally {
    secret.fill(0)
  }
}

/** Forget the UV key, so the next {@link getUvDid} makes a new one (to enrol again after `lost`). */
export async function resetUvKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SECRET_SERVICE }).catch(() => false)
  await Keychain.resetGenericPassword({ service: PUBLIC_SERVICE }).catch(() => false)
}
