package com.attestation

import androidx.biometric.BiometricManager
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * See `LocalityPeripheralModuleTest`'s equivalent, in the sibling
 * `@bifold/react-native-locality-peripheral` package, for why these two
 * near-identical test files exist rather than one shared one: the mapping
 * itself is duplicated by convention across two independently-built RN
 * native packages, so the tests are kept in lockstep the same way.
 */
class AttestationModuleTest {
  @Test
  fun `passcode authMode allows only DEVICE_CREDENTIAL`() {
    assertEquals(
      BiometricManager.Authenticators.DEVICE_CREDENTIAL,
      AttestationModule.allowedAuthenticatorsFor("passcode"),
    )
  }

  @Test
  fun `biometric authMode allows BIOMETRIC_STRONG or DEVICE_CREDENTIAL`() {
    val expected = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    assertEquals(expected, AttestationModule.allowedAuthenticatorsFor("biometric"))
  }

  @Test
  fun `null or unrecognized authMode defaults to the combined set, not passcode-only`() {
    val expected = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    assertEquals(expected, AttestationModule.allowedAuthenticatorsFor(null))
    assertEquals(expected, AttestationModule.allowedAuthenticatorsFor("garbage"))
  }
}
