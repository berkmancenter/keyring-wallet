/**
 * The owner's fresh confirmation (own_agent_subtask.md §3): Face ID,
 * fingerprint or the phone's passcode, asked at the moment the phone acts as
 * the owner of its agent, not only at app unlock.
 *
 * No new dependency: react-native-keychain already in core. A sentinel item is
 * stored once under its own service with BIOMETRY_ANY_OR_DEVICE_PASSCODE, and
 * reading it back shows the system prompt. The item holds nothing secret; the
 * read is the confirmation.
 *
 * @module trust-tasks/module/ownerConfirm
 */
import * as Keychain from 'react-native-keychain'

import type { ConfirmOwner, DeviceCanOwn, OwnerConfirmation, OwnerNotConfirmedReason } from './vtaOwner'

/** Why a confirmation did not happen, so the screen can say it (§7). */
export type OwnerConfirmFailure = OwnerNotConfirmedReason

const SERVICE = 'keyring.owner-confirm'
const SENTINEL_USER = 'owner'

/**
 * Whether this phone can hold an owner key at all: it has biometrics or a
 * passcode. Without one, "Create my agent" refuses and says why (§3).
 */
export async function deviceCanOwn(): Promise<boolean> {
  return Keychain.isPasscodeAuthAvailable().catch(() => false)
}

/**
 * Cancelling is not an error (§7: no message, the button stays). The
 * platforms say it in words, not a shared code: iOS "User canceled the
 * operation" (errSecUserCanceled), Android BiometricPrompt "cancel" or its
 * negative button.
 */
const CANCELLED = /cancel|negative button/i

async function ensureSentinel(): Promise<void> {
  const present = await Keychain.hasGenericPassword({ service: SERVICE }).catch(() => false)
  if (present) return
  await Keychain.setGenericPassword(SENTINEL_USER, 'confirm', {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  })
}

/**
 * Ask the person to confirm an owner act. `reason` is the line the system
 * prompt shows ("Create your agent with this phone").
 */
export async function confirmOwner(reason: string): Promise<OwnerConfirmation> {
  if (!(await deviceCanOwn())) return { ok: false, reason: 'unavailable' }
  try {
    await ensureSentinel()
    const read = await Keychain.getGenericPassword({
      service: SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      authenticationPrompt: { title: reason },
    })
    return read ? { ok: true } : { ok: false, reason: 'failed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: CANCELLED.test(message) ? 'cancelled' : 'failed' }
  }
}

/** The pair the controller takes (`vtaAgent.setOwnerChecks`), for the app to plug in once. */
export const ownerChecks: { confirmOwner: ConfirmOwner; deviceCanOwn: DeviceCanOwn } = { confirmOwner, deviceCanOwn }
