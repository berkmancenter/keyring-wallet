import type { TFunction } from 'i18next'

const KNOWN_METHODS = ['FaceID', 'TouchID', 'Fingerprint', 'DevicePasscode']

/**
 * How a hardware-signed card says its owner unlocked the key, after "Signed by …". An iPhone's attestation proves the
 * Secure Enclave key, not how its owner unlocked it, so on iOS the method is the sending phone's own word and is shown
 * as that ("Face ID, as reported by their phone"), never as something verified. Empty when the card names none.
 */
export function attestedMethodLabel(platform: string | undefined, authType: string | undefined, t: TFunction): string {
  if (!authType) return ''
  if (platform === 'ios') {
    const method = KNOWN_METHODS.includes(authType) ? t(`CredentialOffer.Method${authType}`) : authType
    return ` · ${t('CredentialOffer.MethodReportedByPhone', { method, interpolation: { escapeValue: false } })}`
  }
  const label: Record<string, string> = {
    FaceID: 'Face ID',
    TouchID: 'Touch ID',
    Fingerprint: 'Fingerprint',
    DevicePasscode: 'Passcode',
  }
  return ` via ${label[authType] || authType}`
}
