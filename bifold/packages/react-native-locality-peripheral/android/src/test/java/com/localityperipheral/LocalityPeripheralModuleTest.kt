package com.localityperipheral

import androidx.biometric.BiometricManager
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Regression coverage for the auth-mode fix: this file's `authorizeSignature`
 * used to hardcode `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` for the
 * locality-transcript signature regardless of the caller-resolved
 * `authMode`, while `AttestationModule.kt`'s VRC content signing (same
 * hardware key) honored it — so the two OS prompts could diverge within one
 * ceremony run. `allowedAuthenticatorsFor` is now the single mapping both
 * `respondToSensor`/`authorizeSignature` here and
 * `AttestationModule.signWithHardwareBiometricAuth` use (duplicated by
 * convention, not a shared dependency — see the alias comment in
 * `LocalityPeripheralModule.kt`); this test and
 * `AttestationModuleTest`'s equivalent are kept intentionally identical in
 * shape so a future edit to one that isn't mirrored in the other fails
 * loudly here instead of only showing up as a live-device inconsistency.
 */
class LocalityPeripheralModuleTest {
  @Test
  fun `passcode authMode allows only DEVICE_CREDENTIAL`() {
    assertEquals(
      BiometricManager.Authenticators.DEVICE_CREDENTIAL,
      LocalityPeripheralModule.allowedAuthenticatorsFor("passcode"),
    )
  }

  @Test
  fun `biometric authMode allows BIOMETRIC_STRONG or DEVICE_CREDENTIAL`() {
    val expected = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    assertEquals(expected, LocalityPeripheralModule.allowedAuthenticatorsFor("biometric"))
  }

  @Test
  fun `null or unrecognized authMode defaults to the combined set, not passcode-only`() {
    val expected = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    assertEquals(expected, LocalityPeripheralModule.allowedAuthenticatorsFor(null))
    assertEquals(expected, LocalityPeripheralModule.allowedAuthenticatorsFor("garbage"))
  }
}
