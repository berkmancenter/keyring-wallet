package asml.bkc.harvard.wallet

import org.json.JSONObject

/**
 * Whether this launch is hot-updater's trial of a downloaded update, for the
 * update watchdog (MainActivity). The same test as the iOS watchdog's
 * KeyringOtaTrialBundleId (AppDelegate.mm), on Android's metadata.
 *
 * Reads hot-updater's own files/bundle-store/metadata.json (verificationPending,
 * stagingBundleId, isolationKey; camelCase on Android): there is no public API
 * for it in 0.36.18. A hot-updater bump re-checks this
 * (deploy/keyring-ota/README.md, "Upgrading hot-updater").
 */
object OtaTrial {
    /**
     * The staged bundle id when this launch is a trial of it, else null: the
     * metadata says a staged bundle awaits verification, it was written under this
     * build's isolation key, and the bundle file React Native was given lies inside
     * that staged bundle (the loader chose it, not a rollback to another).
     */
    fun trialBundleId(metadataJson: String?, isolationKey: String, bundleFile: String?): String? {
        if (metadataJson.isNullOrBlank() || bundleFile.isNullOrBlank()) return null
        val metadata =
            try {
                JSONObject(metadataJson)
            } catch (e: Exception) {
                return null
            }
        // Metadata a previous build wrote under another key, which hot-updater ignores too.
        if (metadata.optString("isolationKey") != isolationKey) return null
        if (!metadata.optBoolean("verificationPending", false)) return null
        if (metadata.isNull("stagingBundleId")) return null
        val staging = metadata.optString("stagingBundleId").ifEmpty { return null }
        return if (bundleFile.contains("/$staging/")) staging else null
    }
}
