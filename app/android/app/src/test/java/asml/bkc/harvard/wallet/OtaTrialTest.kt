package asml.bkc.harvard.wallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OtaTrialTest {
    private val key = "HotUpdaterPrefs_ed918b79_0.2.0+271_production"
    private val staging = "01a1708e-25e6-7f0d-b36a-63220f0b1521"
    private val bundle = "/data/user/0/asml.bkc.harvard.wallet/files/bundle-store/$staging/index.android.bundle"

    private fun metadata(
        isolationKey: String? = key,
        verificationPending: Boolean = true,
        stagingBundleId: String? = staging,
    ): String {
        fun quoted(value: String?) = if (value == null) "null" else "\"$value\""
        return """{"schema":"metadata-v1","isolationKey":${quoted(isolationKey)},"stableBundleId":null,""" +
            """"stagingBundleId":${quoted(stagingBundleId)},"verificationPending":$verificationPending,"launchInProgress":true}"""
    }

    @Test
    fun armsOnTheTrialOfTheStagedBundle() {
        assertEquals(staging, OtaTrial.trialBundleId(metadata(), key, bundle))
    }

    @Test
    fun doesNotArmWhenTheIsolationKeyDiffers() {
        assertNull(OtaTrial.trialBundleId(metadata(isolationKey = "HotUpdaterPrefs_ed918b79_0.2.0+270_production"), key, bundle))
        assertNull(OtaTrial.trialBundleId(metadata(isolationKey = null), key, bundle))
    }

    @Test
    fun doesNotArmWhenVerificationIsNotPending() {
        assertNull(OtaTrial.trialBundleId(metadata(verificationPending = false), key, bundle))
    }

    @Test
    fun doesNotArmWhenTheBundleIsNotUnderTheStagingId() {
        assertNull(OtaTrial.trialBundleId(metadata(), key, "assets://index.android.bundle"))
        assertNull(OtaTrial.trialBundleId(metadata(), key, "/data/user/0/asml.bkc.harvard.wallet/files/bundle-store/01a16998-e09d-7e22-8440-98fab0992afd/index.android.bundle"))
        assertNull(OtaTrial.trialBundleId(metadata(), key, null))
    }

    @Test
    fun doesNotArmWithoutAStagedBundleOrOnBadMetadata() {
        assertNull(OtaTrial.trialBundleId(metadata(stagingBundleId = null), key, bundle))
        assertNull(OtaTrial.trialBundleId(null, key, bundle))
        assertNull(OtaTrial.trialBundleId("not json", key, bundle))
    }
}
